import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { getWx, type WxRequestTask } from 'mp-web-polyfill/core'
import { TextDecoder } from 'mp-web-polyfill/text-encoding'
import type PocketBase from 'pocketbase'

export type RealtimeState = 'closed' | 'connecting' | 'open'

export interface RealtimeMessage {
  action: string
  record: Record<string, unknown>
}

export type RealtimeHandler = (message: RealtimeMessage) => void

export interface RealtimeOptions {
  /** 长连接 wx.request 的 timeout(毫秒), 默认 10 分钟(微信默认 60s 就会掐断长连接) */
  timeout?: number
  /** 重连间隔(毫秒), 默认 3000 */
  reconnectionTime?: number
  onStateChange?: (state: RealtimeState) => void
}

interface Subscription {
  topic: string
  handler: RealtimeHandler
}

/**
 * PocketBase realtime 协议客户端(替掉官方 SDK 的 RealtimeService,
 * 因为它硬编码 EventSource/SSE, 没留注入点):
 *
 * 1. GET /api/realtime(enableChunked)建立 SSE 流;
 * 2. 收到 `event: PB_CONNECT` 后拿到 clientId;
 * 3. POST /api/realtime {clientId, subscriptions: [topic, …]} 同步订阅
 *    (PB 0.24+ 协议, 纯 topic 字符串数组);
 * 4. 服务端以 `event: <topic>` 推送 {action, record};
 * 5. 断线后重连, 重新握手拿**新 clientId**, 并全量重放订阅;
 * 6. 订阅清空 → 主动断开(和官方 SDK 语义一致), 下次 subscribe 重新握手。
 */
export class PBRealtimeClient {
  #pb: PocketBase
  #options: RealtimeOptions
  #subs = new Map<string, Subscription>()
  #state: RealtimeState = 'closed'
  #clientId = ''
  #task?: WxRequestTask
  #parser = createParser({ onEvent: (msg) => this.#onSseEvent(msg) })
  #decoder = new TextDecoder()
  #reconnectTimer?: ReturnType<typeof setTimeout>
  #closedByUser = false
  #suppressReconnect = false
  #connecting?: { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void }

  constructor(pb: PocketBase, options: RealtimeOptions = {}) {
    this.#pb = pb
    this.#options = options
  }

  get state(): RealtimeState {
    return this.#state
  }

  /** 与官方 SDK 同签名:返回 unsubscribe 函数 */
  async subscribe(topic: string, handler: RealtimeHandler): Promise<() => Promise<void>> {
    if (this.#closedByUser) throw new Error('realtime: 客户端已关闭')
    if (this.#subs.has(topic)) throw new Error(`realtime: 已订阅 "${topic}"`)
    this.#subs.set(topic, { topic, handler })
    try {
      await this.#whenOpen()
    } catch (err) {
      this.#subs.delete(topic)
      throw err
    }
    return async () => {
      this.#subs.delete(topic)
      await this.#syncSubscriptions()
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    this.#subs.delete(topic)
    await this.#syncSubscriptions()
  }

  async close(): Promise<void> {
    this.#closedByUser = true
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#connecting?.reject(new Error('realtime: closed'))
    this.#connecting = undefined
    this.#setState('closed')
    this.#task?.abort()
    this.#subs.clear()
  }

  #whenOpen(): Promise<void> {
    if (this.#state === 'open') return Promise.resolve()
    if (!this.#connecting) {
      let resolve!: () => void
      let reject!: (err: unknown) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      this.#connecting = { promise, resolve, reject }
      this.#connect()
    }
    return this.#connecting.promise
  }

  #connect(): void {
    const wx = getWx()
    if (!wx) {
      this.#failConnecting(new Error('realtime: 未找到 wx 宿主全局对象'))
      return
    }
    this.#suppressReconnect = false
    this.#setState('connecting')
    this.#decoder = new TextDecoder()
    this.#parser.reset()
    this.#task = wx.request({
      url: `${this.#pb.baseUrl}/api/realtime`,
      method: 'GET',
      header: { accept: 'text/event-stream' },
      enableChunked: true,
      responseType: 'arraybuffer',
      timeout: this.#options.timeout ?? 10 * 60 * 1000,
      success: () => this.#handleDisconnect(),
      fail: () => this.#handleDisconnect(),
    })
    this.#task.onChunkReceived?.((r) => {
      try {
        this.#parser.feed(this.#decoder.decode(new Uint8Array(r.data), { stream: true }))
      } catch {
        // 单帧解析失败不影响整体连接, 断线检测兜底
      }
    })
  }

  #onSseEvent(msg: EventSourceMessage): void {
    if (msg.event === 'PB_CONNECT') {
      let clientId: string
      try {
        clientId = (JSON.parse(msg.data) as { clientId?: string }).clientId ?? ''
      } catch {
        clientId = ''
      }
      if (clientId === '') return
      this.#clientId = clientId
      this.#setState('open')
      this.#syncSubscriptions()
        .then(() => {
          this.#connecting?.resolve()
          this.#connecting = undefined
        })
        .catch((err) => {
          this.#failConnecting(err)
        })
      return
    }
    const sub = msg.event ? this.#subs.get(msg.event) : undefined
    if (!sub) return
    try {
      sub.handler(JSON.parse(msg.data) as RealtimeMessage)
    } catch {
      // 消息体不合法就忽略
    }
  }

  #setState(state: RealtimeState): void {
    if (this.#state === state) return
    this.#state = state
    this.#options.onStateChange?.(state)
  }

  #failConnecting(err: unknown): void {
    this.#connecting?.reject(err)
    this.#connecting = undefined
    if (this.#closedByUser) {
      this.#setState('closed')
      return
    }
    // open 状态断线 → 先落回 connecting, 再按重连间隔重新握手
    if (this.#state === 'open') this.#setState('connecting')
    this.#clientId = ''
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = setTimeout(() => this.#connect(), this.#options.reconnectionTime ?? 3000)
  }

  #handleDisconnect(): void {
    if (this.#closedByUser) {
      this.#setState('closed')
      return
    }
    // 主动断开(订阅清空):抑制自动重连
    if (this.#suppressReconnect) {
      this.#suppressReconnect = false
      return
    }
    this.#failConnecting(new Error('realtime: 连接断开'))
  }

  async #syncSubscriptions(): Promise<void> {
    if (this.#clientId === '') return
    if (this.#subs.size === 0) {
      // 和官方 SDK 一致:没有订阅就断开, 下次 subscribe 时重新握手
      this.#suppressReconnect = true
      this.#clientId = ''
      this.#task?.abort()
      this.#task = undefined
      this.#setState('closed')
      return
    }
    await this.#pb.send('/api/realtime', {
      method: 'POST',
      body: {
        clientId: this.#clientId,
        subscriptions: [...this.#subs.keys()],
      },
    })
  }
}
