import PocketBase, { type BaseAuthStore } from 'pocketbase'
import { injectFetchBridge } from './fetch-bridge'
import { WxAuthStore } from './auth-store'
import { PBRealtimeClient, type RealtimeHandler, type RealtimeOptions } from './realtime'

export { WxAuthStore } from './auth-store'
export {
  PBRealtimeClient,
  type RealtimeOptions,
  type RealtimeMessage,
  type RealtimeState,
  type RealtimeHandler,
} from './realtime'
export { uploadFile, type UploadFileResult } from './upload-file'
export type { BaseAuthStore }

export interface CreateMiniPocketBaseOptions {
  /** wx storage 持久化键,默认 'pocketbase_auth' */
  storageKey?: string
  /** 自定义 authStore(默认 WxAuthStore) */
  authStore?: BaseAuthStore
  realtime?: RealtimeOptions
}

/**
 * 创建小程序适配的 PocketBase 客户端:
 * - 传输层:beforeSend 注入 wx.request fetch 桥(官方 SDK 的 options.fetch || fetch 回退点)
 * - 认证:WxAuthStore 持久化到 wx storage
 * - realtime:替换官方 RealtimeService 为 PBRealtimeClient(wx enableChunked + 重握手重订阅)
 * - 磁盘文件:配合 uploadFile() 助手(wx.uploadFile)
 */
export function createMiniPocketBase(
  baseUrl: string,
  options: CreateMiniPocketBaseOptions = {},
): PocketBase {
  const authStore = options.authStore ?? new WxAuthStore(options.storageKey)
  const pb = new PocketBase(baseUrl, authStore)
  injectFetchBridge(pb)

  const realtimeClient = new PBRealtimeClient(pb, options.realtime)
  const service = pb.realtime as unknown as Record<string, unknown>
  service.subscribe = (topic: string, handler: RealtimeHandler) =>
    realtimeClient.subscribe(topic, handler)
  service.unsubscribe = (topic: string) => realtimeClient.unsubscribe(topic)
  ;(pb as unknown as { __realtimeClient?: PBRealtimeClient }).__realtimeClient = realtimeClient

  return pb
}

/** 取回被替换的 realtime 客户端(状态展示 / 主动 close) */
export function getRealtimeClient(pb: PocketBase): PBRealtimeClient | undefined {
  return (pb as unknown as { __realtimeClient?: PBRealtimeClient }).__realtimeClient
}
