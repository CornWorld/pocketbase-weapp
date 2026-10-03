import { fetch as mpFetch } from 'mp-web-polyfill/fetch'
import type PocketBase from 'pocketbase'

/**
 * 通过官方 SDK 的全局 beforeSend 钩子把传输层换成 wx.request 桥。
 * SDK 的 send() 实现:`const fetchFunc = options.fetch || fetch`,
 * 且 beforeSend 结果可整体替换 options —— 一处注入全局生效。
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
