/**
 * 业务错误码与中文提示（对应《详细设计报告》5.2 共用请求响应协议）
 *
 * 后端响应结构：{ code: 0 | 业务码字符串, message, data }
 * 成功 code === 0；失败 code 非零且为下表字符串。
 */

export const ERROR_MESSAGES = {
  AUTH_REQUIRED: '登录状态已失效，请重新登录',
  FORBIDDEN: '没有权限执行该操作（账号可能已冻结）',
  NOT_FOUND: '资源不存在或已被删除',
  STATE_CONFLICT: '当前状态不允许此操作，请刷新后重试',
  AMOUNT_CHANGED: '金额已变化，请重新确认报价',
  INSUFFICIENT_BALANCE: '账户余额不足',
  INSUFFICIENT_CREDIT: '可用授信额度不足',
  IDEMPOTENCY_CONFLICT: '该请求已被处理过且内容不一致，请刷新后重试',
  FILE_TOO_LARGE: '文件超过大小限制（最大 5 MiB）',
  FILE_TYPE_INVALID: '文件格式不支持，仅接受 JPEG / PNG',
  VALIDATION_ERROR: '提交内容有误，请检查必填项',
  TOO_MANY_REQUESTS: '操作过于频繁，请稍后再试',
  SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  INTERNAL_ERROR: '系统异常，请联系管理员并提供请求编号'
}

/** 需要在页面上「引导用户下一步」的错误码 */
export const RECOVERABLE_CODES = new Set([
  'STATE_CONFLICT',
  'AMOUNT_CHANGED',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_CREDIT',
  'AUTH_REQUIRED'
])

export function messageForCode(code, fallback) {
  if (!code) return fallback || '请求失败'
  return ERROR_MESSAGES[code] || fallback || String(code)
}

/** 后端 HTTP 状态码 → 兜底中文提示 */
export const HTTP_FALLBACK = {
  401: '登录状态已失效，请重新登录',
  403: '没有权限执行该操作',
  404: '资源不存在',
  409: '操作冲突，请刷新后重试',
  413: '文件过大',
  415: '文件格式不支持',
  422: '参数校验失败',
  429: '操作过于频繁',
  500: '服务器内部错误',
  503: '服务暂时不可用'
}

export function messageForStatus(status) {
  return HTTP_FALLBACK[status] || `请求失败（HTTP ${status}）`
}
