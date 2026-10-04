import { BaseAuthStore } from 'pocketbase'
import { getWx } from 'mp-web-polyfill/core'

/**
 * PB 官方 authStore 的 wx storage 持久化实现:
 * 构造时从 wx storage 恢复, save/clear 同步落盘(和小程序的同步存储 API 一一对应)。
 */
export class WxAuthStore extends BaseAuthStore {
  readonly storageKey: string

  constructor(storageKey = 'pocketbase_auth') {
    super()
    this.storageKey = storageKey
    const raw = getWx()?.getStorageSync(storageKey)
    if (typeof raw === 'string' && raw !== '') {
      try {
        const parsed = JSON.parse(raw) as { token?: string; record?: unknown }
        if (parsed.token) super.save(parsed.token, (parsed.record ?? null) as never)
      } catch {
        // 持久化数据坏了就当成未登录
      }
    }
  }

  override save(token: string, record: unknown): void {
    super.save(token, record as never)
    getWx()?.setStorageSync(this.storageKey, JSON.stringify({ token, record: record ?? null }))
  }

  override clear(): void {
    super.clear()
    getWx()?.removeStorageSync(this.storageKey)
  }
}
