/**
 * 令牌与用户凭证的本地存储适配层
 *
 * 依据《详细设计报告》3.17 C16 遗留待决项：
 *  「Web 访问令牌保持在内存，刷新凭证持久化适配在 M1 结合站点安全方案评审；
 *    最小课程实现可使用按标签页隔离的 sessionStorage，须承认其可被同源脚本读取，
 *    不能称其已加密或可防 XSS。」
 *
 * 本实现选择：access token 仅存内存；refresh token 与本地会话标识存 sessionStorage。
 * 注意：sessionStorage 不等同加密存储，仅用于课程演示，正式部署应改为
 *      HttpOnly Cookie + CSRF 令牌方案（届时需同步后端契约）。
 */

const REFRESH_KEY = 'finlend.refresh_token'
const SID_KEY = 'finlend.session_sid'
const SCOPE_KEY = 'finlend.client_scope'

/** access token 只放内存 */
let accessToken = ''
let sessionId = ''

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = token || ''
}

export function getSessionId() {
  if (!sessionId) {
    try {
      sessionId = sessionStorage.getItem(SID_KEY) || ''
    } catch {
      sessionId = ''
    }
  }
  return sessionId
}

export function setSessionId(sid) {
  sessionId = sid || ''
  try {
    sessionStorage.setItem(SID_KEY, sessionId)
  } catch {
    /* storage 不可用时退化为内存态 */
  }
}

export function getRefreshToken() {
  try {
    return sessionStorage.getItem(REFRESH_KEY) || ''
  } catch {
    return ''
  }
}

export function setRefreshToken(token) {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token)
    else sessionStorage.removeItem(REFRESH_KEY)
  } catch {
    /* ignore */
  }
}

export function getClientScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) || ''
  } catch {
    return ''
  }
}

/** 记录上一次选择的入口（用户端 / 管理端），刷新后回到对应登录页 */
export function setClientScope(scope) {
  try {
    if (scope) localStorage.setItem(SCOPE_KEY, scope)
    else localStorage.removeItem(SCOPE_KEY)
  } catch {
    /* ignore */
  }
}

export function clearCredentials() {
  accessToken = ''
  sessionId = ''
  setRefreshToken('')
  try {
    sessionStorage.removeItem(SID_KEY)
  } catch {
    /* ignore */
  }
}
