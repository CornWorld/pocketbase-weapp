import { BaseAuthStore } from 'pocketbase'
import { getWx } from '@cornworld/mp-core'

/**
 * PB 官方 authStore 的 wx storage 持久化实现:
 * 构造时从 wx storage 恢复,save/clear 同步落盘(与小程序同步存储 API 对应)。
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
        // 损坏的持久化数据视为未登录
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
