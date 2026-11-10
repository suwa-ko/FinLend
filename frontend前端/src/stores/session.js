import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { authApi, userApi } from '@/api'
import {
  clearCredentials,
  getAccessToken,
  getClientScope,
  getRefreshToken,
  setAccessToken,
  setClientScope,
  setRefreshToken,
  setSessionId
} from '@/utils/storage'
import { clearIdempotencyKeys } from '@/utils/idempotency'

/**
 * 会话与用户态
 * 对应《详细设计报告》6.2 会话契约：
 *  - 用户端与管理端使用不同登录入口，公开用户登录不能签发 ADMIN 权限
 *  - Web 与 App 会话独立，退出只吊销当前 sid 的会话
 */
export const useSessionStore = defineStore('session', () => {
  const accessToken = ref(getAccessToken())
  const refreshToken = ref(getRefreshToken())
  const profile = ref(null)
  const scope = ref(getClientScope() || 'borrower') // borrower | admin
  const loadingProfile = ref(false)

  const isLoggedIn = computed(() => Boolean(accessToken.value))
  const isAdmin = computed(() => scope.value === 'admin')
  const displayName = computed(() => profile.value?.display_name || profile.value?.username || '')
  const isVerified = computed(() => Boolean(profile.value?.verified))

  function applyTokens(data, incomingScope) {
    accessToken.value = data.access_token
    refreshToken.value = data.refresh_token
    setAccessToken(data.access_token)
    setRefreshToken(data.refresh_token)
    if (data.sid) setSessionId(data.sid)
    if (incomingScope) {
      scope.value = incomingScope
      setClientScope(incomingScope)
    }
  }

  /**
   * 切换身份登录前先彻底清空旧会话。
   * 用户端与管理端共用同一份本地凭证存储（同一浏览器、同一标签页），
   * 若不清空，切到管理员后残留的借款人 refresh token 会在 401 续期时被误用，
   * 导致刷新出错误的会话或被踢回登录页。
   */
  function resetForSwitch() {
    accessToken.value = ''
    refreshToken.value = ''
    profile.value = null
    clearCredentials()
    clearIdempotencyKeys()
  }

  /** 借款人登录 */
  async function login(payload) {
    resetForSwitch()
    const data = await authApi.login({ ...payload, client_type: 'WEB' })
    applyTokens(data, 'borrower')
    await fetchProfile()
    return data
  }

  /** 管理员登录（独立入口） */
  async function adminLogin(payload) {
    resetForSwitch()
    const data = await authApi.adminLogin({ ...payload, client_type: 'WEB' })
    applyTokens(data, 'admin')
    await fetchProfile()
    return data
  }

  async function fetchProfile() {
    if (!accessToken.value) return null
    loadingProfile.value = true
    try {
      profile.value = await userApi.me()
      return profile.value
    } finally {
      loadingProfile.value = false
    }
  }

  async function logout() {
    try {
      if (accessToken.value) await authApi.logout()
    } catch {
      /* 退出失败也要清本地凭证 */
    } finally {
      reset()
    }
  }

  function reset() {
    accessToken.value = ''
    refreshToken.value = ''
    profile.value = null
    clearCredentials()
    clearIdempotencyKeys()
  }

  function switchScope(next) {
    scope.value = next
    setClientScope(next)
  }

  return {
    accessToken,
    refreshToken,
    profile,
    scope,
    loadingProfile,
    isLoggedIn,
    isAdmin,
    displayName,
    isVerified,
    login,
    adminLogin,
    fetchProfile,
    logout,
    reset,
    switchScope
  }
})
