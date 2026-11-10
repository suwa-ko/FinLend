import { describe, expect, it, beforeEach } from 'vitest'
import {
  idempotencyKey,
  releaseIdempotencyKey,
  clearIdempotencyKeys,
  randomId
} from '@/utils/idempotency'

describe('幂等键（详细设计 6.3）', () => {
  beforeEach(() => clearIdempotencyKeys())

  it('同一 scope 反复取键得到同一个键（超时重试沿用原键）', () => {
    const a = idempotencyKey('APPLICATION_CREATE_1')
    const b = idempotencyKey('APPLICATION_CREATE_1')
    expect(a).toBe(b)
  })

  it('不同 scope 得到不同的键', () => {
    expect(idempotencyKey('REPAY_1_1')).not.toBe(idempotencyKey('REPAY_1_2'))
  })

  it('成功后释放，下一次操作换新键', () => {
    const first = idempotencyKey('SIGN_10')
    releaseIdempotencyKey('SIGN_10')
    const second = idempotencyKey('SIGN_10')
    expect(first).not.toBe(second)
  })

  it('退出登录清空全部键，避免串用他人键', () => {
    const first = idempotencyKey('SETTLE_5')
    clearIdempotencyKeys()
    expect(idempotencyKey('SETTLE_5')).not.toBe(first)
  })

  it('键包含 scope 前缀并具备足够熵', () => {
    const k = idempotencyKey('REPAY')
    expect(k.startsWith('REPAY-')).toBe(true)
    expect(k.length).toBeGreaterThan(25)
  })

  it('随机标识长度可控且几乎不重复', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId(24)))
    expect(ids.size).toBe(200)
  })
})
