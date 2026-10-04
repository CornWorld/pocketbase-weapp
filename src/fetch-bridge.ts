import { fetch as mpFetch } from 'mp-web-polyfill/fetch'
import type PocketBase from 'pocketbase'

/**
 * 借官方 SDK 的全局 beforeSend 钩子, 把传输层换成 wx.request 桥。
 * SDK 的 send() 实现:`const fetchFunc = options.fetch || fetch`,
 * 且 beforeSend 的结果可以整体替换 options —— 注入一处, 全局生效。
 */
export function injectFetchBridge(pb: PocketBase): void {
  pb.beforeSend = async (url, sendOptions) => ({
    url,
    options: {
      ...sendOptions,
      fetch: mpFetch as unknown as typeof globalThis.fetch,
    },
  })
}
