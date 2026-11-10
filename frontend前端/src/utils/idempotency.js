/**
 * 幂等键生成（对应《详细设计报告》6.3 幂等与超时）
 *
 * 规则：
 *  - 提交申请、审批、签约、放款、还款等状态写接口必须携带 Idempotency-Key
 *  - 同一逻辑请求重试必须复用原键，不能换新键
 *  - 键只标识「这一次操作」，不描述业务内容
 */
import { ref } from 'vue'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 生成一个高熵随机标识（不依赖 crypto.randomUUID，兼容老旧浏览器） */
export function randomId(len = 32) {
  const bytes =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(len))
      : null
  if (bytes) {
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
  }
  let out = ''
  for (let i = 0; i < len; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/**
 * 幂等键仓库：以「操作 + 业务标识」为 scope 缓存键，
 * 保证同一表单在超时重试、网络恢复后仍复用同一个键。
 */
const keyStore = new Map()

export function idempotencyKey(scope) {
  if (!keyStore.has(scope)) keyStore.set(scope, `${scope}-${randomId(24)}`)
  return keyStore.get(scope)
}

/** 成功后释放该 scope 的键，下一次操作将获得新键 */
export function releaseIdempotencyKey(scope) {
  keyStore.delete(scope)
}

/** 清空所有键（换账号 / 退出登录时调用，避免串用他人键） */
export function clearIdempotencyKeys() {
  keyStore.clear()
}

/**
 * 响应式暴露最近一次写操作使用的键，便于联调时在「结果未知」场景下展示与复用。
 */
export const lastWriteKey = ref('')
export function rememberLastWriteKey(k) {
  lastWriteKey.value = k
}
