/**
 * Axios 封装 —— 对应《详细设计报告》3.17 C16 WebRequestClient
 *
 * 核心规则（逐条对应设计文档）：
 *  1. 附加访问凭证（Authorization: Bearer）
 *  2. 401 时共享一次刷新 Promise —— 同一时刻只发一次 refresh，其余请求等待
 *  3. 刷新成功重放原请求，且写操作仍沿用原 Idempotency-Key
 *  4. 刷新失败清除凭证并跳转登录，不无限重试
 *  5. 写操作（POST/PUT/PATCH/DELETE）由调用方传入 idempotencyKey
 *  6. 网络超时：保留原键与非敏感表单，标记结果待确认（unknown）
 *  7. 金额显示后端值（本层不做任何业务计算）
 */
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
  setSessionId,
  clearCredentials,
  getClientScope
} from './storage'
import { messageForCode, messageForStatus } from './errors'

const baseURL = '/api/v1'

export class ApiError extends Error {
  constructor({ status = 0, code = '', message, data = null, requestId = '', unknown = false }) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
    this.requestId = requestId
    this.unknown = unknown
  }
}

const http = axios.create({
  baseURL,
  // 15 秒客户端超时（原报告待确认配置，不是服务端失败判据）
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

/** 会话失效时的统一处理回调，由 router 注入，避免循环依赖 */
let onSessionExpired = null
export function registerSessionExpiredHandler(fn) {
  onSessionExpired = fn
}

/** 刷新令牌接口单独用裸 axios，避免拦截器递归 */
async function doRefresh() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('no refresh token')
  const resp = await axios.post(
    `${baseURL}/auth/refresh`,
    { refresh_token: refreshToken },
    { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
  )
  const body = resp.data || {}
  if (body.code !== 0 || !body.data) throw new Error('refresh rejected')
  const { access_token, refresh_token, sid } = body.data
  setAccessToken(access_token)
  setRefreshToken(refresh_token)
  if (sid) setSessionId(sid)
  return access_token
}

/** 同一时刻只允许一个刷新请求在飞 */
let refreshPromise = null

function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function expireSession() {
  clearCredentials()
  if (typeof onSessionExpired === 'function') onSessionExpired()
}

// ------------------------- 请求拦截 -------------------------
http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ------------------------- 响应拦截 -------------------------
http.interceptors.response.use(
  (resp) => {
    const body = resp.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data
      throw new ApiError({
        status: resp.status,
        code: body.code,
        message: messageForCode(body.code, body.message),
        data: body.data,
        requestId: resp.headers['x-request-id'] || ''
      })
    }
    return body
  },
  async (error) => {
    const { response, config, code: axiosCode } = error

    // 网络超时 / 断网：结果未知，保留幂等键供用户重试
    if (!response) {
      const unknown = axiosCode === 'ECONNABORTED' || axiosCode === 'ETIMEDOUT'
      return Promise.reject(
        new ApiError({
          status: 0,
          code: unknown ? 'TIMEOUT_UNKNOWN' : 'NETWORK_ERROR',
          message: unknown
            ? '请求超时，结果待确认。请先查询业务结果，或以相同幂等键重试。'
            : '网络连接失败，请检查网络后重试',
          unknown
        })
      )
    }

    const body = response.data || {}
    const bizCode = body.code
    const requestId = response.headers?.['x-request-id'] || ''
    const original = config || {}

    // 401：只尝试一次续期；刷新成功则重放原请求（沿用原幂等键）
    const isAuthEndpoint = /\/auth\/(login|refresh|logout)$/.test(original.url || '')
    if (response.status === 401 && !original.__retried && !isAuthEndpoint && getRefreshToken()) {
      original.__retried = true
      try {
        const newToken = await refreshOnce()
        original.headers = original.headers || {}
        original.headers.Authorization = `Bearer ${newToken}`
        return http.request(original)
      } catch {
        expireSession()
        return Promise.reject(
          new ApiError({
            status: 401,
            code: 'AUTH_REQUIRED',
            message: messageForCode('AUTH_REQUIRED'),
            requestId
          })
        )
      }
    }

    if (response.status === 401) expireSession()

    return Promise.reject(
      new ApiError({
        status: response.status,
        code: bizCode || '',
        message: bizCode ? messageForCode(bizCode, body.message) : messageForStatus(response.status),
        data: body.data ?? null,
        requestId
      })
    )
  }
)

/**
 * 写操作统一封装：自动带上 Idempotency-Key
 * @param {'post'|'put'|'patch'|'delete'} method
 */
export function write(method, url, payload, idemKey, config = {}) {
  const headers = { ...(config.headers || {}) }
  if (idemKey) headers['Idempotency-Key'] = idemKey
  return http.request({ method, url, data: payload, headers, ...config })
}

export const api = {
  get: (url, config) => http.get(url, config),
  post: (url, data, config) => http.post(url, data, config),
  put: (url, data, config) => http.put(url, data, config),
  patch: (url, data, config) => http.patch(url, data, config),
  delete: (url, config) => http.delete(url, config),
  write
}

/** 统一提示（页面可覆盖为局部展示） */
export function toastError(err) {
  const msg = err instanceof ApiError ? err.message : err?.message || '操作失败'
  ElMessage.error(msg)
}

export function toastSuccess(msg = '操作成功') {
  ElMessage.success(msg)
}

/** 当前入口：管理端跳 /admin/login，用户端跳 /login */
export function loginPathForScope() {
  return getClientScope() === 'admin' ? '/admin/login' : '/login'
}

export default http
