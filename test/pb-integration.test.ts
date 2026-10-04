import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startWxMock, type WxMock } from '@cornworld/wx-mock'
import { setWxForTesting } from 'mp-web-polyfill/core'
import { Blob, File as MpFile, FormData as MpFormData } from 'mp-web-polyfill/fetch'
import { createMiniPocketBase, getRealtimeClient } from '../src/index'

// ———— C+ 层:真实 PocketBase 服务端集成(整条链路的最终锚点) ————
// 前置:bash scripts/ensure-pb.sh(PB_URL 可覆盖, 默认 127.0.0.1:8090)
// PB 连不上时整组跳过(单测/CI 没有 PB 环境也能过)

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090'
const pbReachable = await fetch(`${PB_URL}/api/health`)
  .then((r) => r.ok)
  .catch(() => false)

let mock: WxMock

beforeEach(async () => {
  // wx 宿主指向真实 PB:wx.request 桥发的是绝对 URL, 会绕过 mock 自身的 origin
  mock = await startWxMock()
  setWxForTesting(mock.wx)
  ;(globalThis as Record<string, unknown>).FormData = MpFormData
  ;(globalThis as Record<string, unknown>).Blob = Blob
  ;(globalThis as Record<string, unknown>).File = MpFile
})

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).FormData
  delete (globalThis as Record<string, unknown>).Blob
  delete (globalThis as Record<string, unknown>).File
  setWxForTesting(undefined)
  await mock.close()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(cond: () => boolean, timeout = 8000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout')
    await sleep(25)
  }
}

describe.skipIf(!pbReachable)(`PocketBase 集成(${PB_URL},真实服务端)`, () => {
  it('health + 空 list 请求走通 wx 桥', async () => {
    const pb = createMiniPocketBase(PB_URL)
    const result = await pb.collection('notes').getList(1, 5)
    expect(typeof result.totalItems).toBe('number')
    expect(result.items).toBeInstanceOf(Array)
  })

  it('authWithPassword 真实 JWT + wx storage 持久化', async () => {
    const pb = createMiniPocketBase(PB_URL)
    await pb.collection('users').authWithPassword('u@cornworld.dev', '1234567890')
    expect(pb.authStore.isValid).toBe(true)
    expect(pb.authStore.record?.email).toBe('u@cornworld.dev')

    const stored = JSON.parse(mock.wx.getStorageSync('pocketbase_auth') as string)
    expect(stored.token).toBe(pb.authStore.token)

    // 刷新后的客户端从 storage 恢复
    const pb2 = createMiniPocketBase(PB_URL)
    expect(pb2.authStore.isValid).toBe(true)
    expect(pb2.authStore.record?.id).toBe(pb.authStore.record?.id)
  })

  it('CRUD 全流程(create → getOne → update → delete)', async () => {
    const pb = createMiniPocketBase(PB_URL)
    await pb.collection('users').authWithPassword('u@cornworld.dev', '1234567890')

    const created = await pb
      .collection('notes')
      .create({ title: '集成测试', body: 'wx.request 桥写入' } as never)
    expect(created.title).toBe('集成测试')

    const fetched = await pb.collection('notes').getOne(created.id as string)
    expect(fetched.body).toBe('wx.request 桥写入')

    const updated = await pb.collection('notes').update(created.id as string, {
      body: '更新后的正文',
    } as never)
    expect(updated.body).toBe('更新后的正文')

    await pb.collection('notes').delete(created.id as string)
    await expect(pb.collection('notes').getOne(created.id as string)).rejects.toThrowError()
  })

  it('文件上传(内存 Blob)→ 文件 URL 可下载', async () => {
    const pb = createMiniPocketBase(PB_URL)
    await pb.collection('users').authWithPassword('u@cornworld.dev', '1234567890')

    const fd = new MpFormData()
    fd.append('title', '带附件的笔记')
    fd.append(
      'doc',
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9])], { type: 'application/zip' }),
      'attach.bin',
    )
    const record = (await pb.collection('notes').create(fd as never)) as unknown as {
      id: string
      doc: string
    }
    // PB 会给存储文件名追加随机后缀
    expect(record.doc).toMatch(/^attach_.+\.bin$/)

    const fileUrl = `${PB_URL}/api/files/notes/${record.id}/${record.doc}`
    const response = await fetch(fileUrl)
    expect(response.status).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes].slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('realtime:订阅 notes → 另一客户端创建 → 收到 create 事件', async () => {
    const pb = createMiniPocketBase(PB_URL, {
      realtime: { timeout: 15000, reconnectionTime: 500 },
    })
    const events: { action: string; record: { id?: string } }[] = []
    const unsub = await pb.realtime.subscribe('notes', (msg) => events.push(msg))

    // 另一个客户端(同服务端)创建记录
    const writer = createMiniPocketBase(PB_URL)
    const created = await writer
      .collection('notes')
      .create({ title: 'realtime 触发' } as never)

    await waitFor(() => events.some((e) => e.record?.id === created.id))
    const hit = events.find((e) => e.record?.id === created.id)
    expect(hit?.action).toBe('create')

    await unsub()
    await getRealtimeClient(pb)?.close()

    // 清理
    await writer.collection('notes').delete(created.id as string)
    void sleep
  })
})
