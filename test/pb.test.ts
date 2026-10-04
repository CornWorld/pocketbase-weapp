import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'
import { setWxForTesting } from 'mp-web-polyfill/core'
import { Blob, File as MpFile, FormData as MpFormData } from 'mp-web-polyfill/fetch'
import { createMiniPocketBase, getRealtimeClient } from '../src/index'

const pathname = (req: { url?: string }) => new URL(req.url ?? '/', 'http://x').pathname

/** 伪造未过期 JWT(SDK 0.28 的 isValid 基于 isTokenExpired) */
function fakeToken(id = 'u1'): string {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    id,
    type: 'auth',
    collectionId: 'pbc_users',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`
}

let mock: WxMock

beforeEach(async () => {
  mock = await startWxMock()
  setWxForTesting(mock.wx)
})

afterEach(() => {
  setWxForTesting(undefined)
  // 恢复可能存在的全局注入(multipart 用例)
  delete (globalThis as Record<string, unknown>).FormData
  delete (globalThis as Record<string, unknown>).Blob
  delete (globalThis as Record<string, unknown>).File
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout')
    await sleep(10)
  }
}

describe('fetch 桥注入(beforeSend)', () => {
  it('getList 请求经 wx 桥到达服务端,分页参数与响应解析正确', async () => {
    mock.handler = (req, res) => {
      expect(pathname(req)).toBe('/api/collections/posts/records')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          page: 1,
          perPage: 20,
          totalItems: 1,
          totalPages: 1,
          items: [{ id: 'r1', title: '第一篇' }],
        }),
      )
    }
    const pb = createMiniPocketBase(mock.origin)
    const result = await pb.collection('posts').getList(1, 20)
    expect(result.totalItems).toBe(1)
    expect(result.items[0]?.title).toBe('第一篇')
    expect(mock.requests[0]?.method).toBe('GET')
  })

  it('authWithPassword 后 token 自动带在后续请求上', async () => {
    const token = fakeToken('u1')
    mock.handler = (req, res) => {
      if (pathname(req) === '/api/collections/users/auth-with-password') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            token,
            record: { id: 'u1', email: 'u@t.co', collectionName: 'users' },
          }),
        )
        return
      }
      expect(req.headers['authorization']).toBe(token)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ page: 1, perPage: 20, totalItems: 0, totalPages: 0, items: [] }))
    }
    const pb = createMiniPocketBase(mock.origin)
    await pb.collection('users').authWithPassword('u@t.co', 'secret')
    expect(pb.authStore.isValid).toBe(true)
    await pb.collection('posts').getList(1, 20)
    expect(mock.requests.at(-1)?.headers['authorization']).toBe(token)
  })

  it('认证状态持久化到 wx storage,新客户端自动恢复', async () => {
    const token = fakeToken('u2')
    mock.handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ token, record: { id: 'u2', collectionName: 'users' } }))
    }
    const pb = createMiniPocketBase(mock.origin)
    await pb.collection('users').authWithPassword('u@t.co', 'secret')

    const stored = mock.wx.getStorageSync('pocketbase_auth') as string
    expect(JSON.parse(stored).token).toBe(token)

    // 新客户端从 storage 恢复
    const pb2 = createMiniPocketBase(mock.origin)
    expect(pb2.authStore.isValid).toBe(true)
    expect(pb2.authStore.token).toBe(token)

    pb2.authStore.clear()
    expect(mock.wx.getStorageSync('pocketbase_auth')).toBe('')
  })
})

describe('multipart 文件上传(内存 Blob,真机前提:全局已安装)', () => {
  it('create + FormData 经桥序列化为 multipart', async () => {
    // 和真机一致:mp-web-runtime 安装后, 全局 FormData/Blob/File 就是 polyfill 实现,
    // 官方 SDK 的 instanceof FormData 检查才认得出来
    ;(globalThis as Record<string, unknown>).FormData = MpFormData
    ;(globalThis as Record<string, unknown>).Blob = Blob
    ;(globalThis as Record<string, unknown>).File = MpFile

    let capturedBody: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let contentType = ''
    mock.handler = (_req, res, body) => {
      capturedBody = body
      contentType = _req.headers['content-type'] ?? ''
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'r9', title: '带附件' }))
    }
    const pb = createMiniPocketBase(mock.origin)
    const fd = new MpFormData()
    fd.append('title', '带附件')
    fd.append('doc', new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' }), 'a.txt')
    const record = await pb.collection('posts').create(fd as never)
    expect(record.id).toBe('r9')
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    const text = capturedBody.toString('utf8')
    expect(text).toContain('name="title"')
    expect(text).toContain('name="doc"; filename="a.txt"')
  })
})

describe('realtime(PB_CONNECT 握手 + 订阅同步 + 断线重连)', () => {
  it('握手 → 订阅确认 → 收到事件 → 断线重连换新 clientId', async () => {
    const sseStreams: { res: import('node:http').ServerResponse; id: number }[] = []
    const posts = new Set<string>()
    let connections = 0

    mock.handler = (req, res, body) => {
      if (req.method === 'GET' && pathname(req) === '/api/realtime') {
        connections += 1
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`event: PB_CONNECT\ndata: {"clientId":"c-${connections}"}\n\n`)
        sseStreams.push({ res, id: connections })
        return
      }
      if (req.method === 'POST' && pathname(req) === '/api/realtime') {
        const parsed = JSON.parse(body.toString('utf8')) as {
          clientId: string
          subscriptions: { eventId: string; topic: string }[]
        }
        posts.add(`${parsed.clientId}:${parsed.subscriptions.join(',')}`)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }
      res.writeHead(404)
      res.end()
    }

    const pb = createMiniPocketBase(mock.origin, {
      realtime: { reconnectionTime: 20, timeout: 5000 },
    })
    const received: string[] = []
    const unsub = await pb.realtime.subscribe('posts', (msg) => received.push(msg.action))

    await waitFor(() => posts.size >= 1)
    expect([...posts][0]).toBe('c-1:posts')

    // 服务端推送
    sseStreams[0]?.res.write('event: posts\ndata: {"action":"create","record":{"id":"r1"}}\n\n')
    await waitFor(() => received.length >= 1)
    expect(received).toEqual(['create'])

    // 断线 → 重连 → 新 clientId 全量重放订阅
    sseStreams[0]?.res.end()
    await waitFor(() => connections >= 2 && posts.size >= 2)
    expect([...posts]).toContain('c-2:posts')

    // unsubscribe → 订阅清空 → 主动断开(和官方 SDK 语义一致)
    await unsub()
    expect(getRealtimeClient(pb)?.state).toBe('closed')
    await getRealtimeClient(pb)?.close()
  })

  it('重复订阅同 topic 报错,close 后订阅抛错', async () => {
    const sseRes: import('node:http').ServerResponse[] = []
    mock.handler = (req, res) => {
      if (req.method === 'GET' && pathname(req) === '/api/realtime') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: PB_CONNECT\ndata: {"clientId":"c-1"}\n\n')
        sseRes.push(res)
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    }
    const pb = createMiniPocketBase(mock.origin)
    await pb.realtime.subscribe('posts', () => {})
    await expect(pb.realtime.subscribe('posts', () => {})).rejects.toThrowError(/已订阅/)

    await getRealtimeClient(pb)?.close()
    await expect(pb.realtime.subscribe('posts', () => {})).rejects.toThrowError(/已关闭/)
  })
})

describe('uploadFile(wx.uploadFile 桥)', () => {
  it('带 token 的 multipart 创建请求', async () => {
    mock.handler = (_req, res, body) => {
      expect(_req.headers['authorization']).toBe('TOKEN_U1')
      expect(body.toString('utf8')).toContain('name="title"')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'r-file', title: '磁盘文件' }))
    }
    const pb = createMiniPocketBase(mock.origin)
    pb.authStore.save('TOKEN_U1', { id: 'u1' } as never)
    const { writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const filePath = join(tmpdir(), `pb-sdk-test-${Date.now()}.txt`)
    writeFileSync(filePath, 'hello')
    const { uploadFile } = await import('../src/upload-file')
    const result = await uploadFile(pb, 'posts', 'doc', filePath, { title: '磁盘文件' })
    expect(result.response.id).toBe('r-file')
  })
})
