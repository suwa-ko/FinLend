/**
 * API 封装 —— 按《详细设计报告》5.3 接口清单 A01–A10 组织
 * 所有金额、利率、ID 均为字符串；日期 YYYY-MM-DD；时间 ISO 8601 带 +08:00。
 */
import { api, write } from '@/utils/request'

// ============================ A01 认证 ============================
export const authApi = {
  sendCode: (phone) => api.post('/auth/code', { phone }),
  register: (payload, idemKey) => write('post', '/auth/register', payload, idemKey),
  login: (payload) => api.post('/auth/login', payload),
  adminLogin: (payload) => api.post('/admin/auth/login', payload),
  refresh: (refreshToken) => api.post('/auth/refresh', { refresh_token: refreshToken }),
  logout: () => api.post('/auth/logout')
}

// ============================ A02 用户资料 ============================
export const userApi = {
  me: () => api.get('/users/me'),
  updateMe: (payload, idemKey) => write('patch', '/users/me', payload, idemKey),
  submitIdentity: (payload, idemKey) => write('post', '/users/me/identity', payload, idemKey),
  bankCards: () => api.get('/users/me/bank-cards'),
  addBankCard: (payload, idemKey) => write('post', '/users/me/bank-cards', payload, idemKey),
  removeBankCard: (id, idemKey) => write('delete', `/users/me/bank-cards/${id}`, null, idemKey),
  setDefaultCard: (id, idemKey) => write('put', `/users/me/bank-cards/${id}/default`, null, idemKey)
}

// ============================ A03 产品与试算 ============================
export const productApi = {
  list: (params) => api.get('/products', { params }),
  detail: (id) => api.get(`/products/${id}`),
  quote: (payload) => api.post('/loans/quote', payload)
}

// ============================ A04 申请 ============================
export const applicationApi = {
  list: (params) => api.get('/applications', { params }),
  create: (payload, idemKey) => write('post', '/applications', payload, idemKey),
  detail: (id) => api.get(`/applications/${id}`),
  cancel: (id, idemKey) => write('post', `/applications/${id}/cancel`, null, idemKey),
  sign: (id, payload, idemKey) => write('post', `/applications/${id}/sign`, payload, idemKey)
}

// ============================ A05 账户 ============================
export const accountApi = {
  overview: () => api.get('/accounts/me'),
  flows: (params) => api.get('/accounts/me/flows', { params })
}

// ============================ A06 还款 ============================
export const repaymentApi = {
  plans: (applicationId) => api.get(`/applications/${applicationId}/plans`),
  records: (applicationId) => api.get(`/applications/${applicationId}/repayments`),
  repay: (applicationId, payload, idemKey) =>
    write('post', `/applications/${applicationId}/repay`, payload, idemKey),
  settlementQuote: (applicationId) => api.get(`/applications/${applicationId}/settlement-quote`),
  settle: (applicationId, payload, idemKey) =>
    write('post', `/applications/${applicationId}/settle`, payload, idemKey)
}

// ============================ A07 文件 ============================
export const fileApi = {
  upload: (file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/files', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  meta: (id) => api.get(`/files/${id}`),
  /** 鉴权读取图片字节，返回 blob URL（不能用公开路径直接 img src） */
  blobUrl: async (id) => {
    const resp = await api.get(`/files/${id}`, { responseType: 'blob' })
    return URL.createObjectURL(resp)
  }
}

// ============================ A08 消息 ============================
export const messageApi = {
  list: (params) => api.get('/messages', { params }),
  unreadCount: () => api.get('/messages/unread-count'),
  markRead: (id, idemKey) => write('put', `/messages/${id}/read`, null, idemKey)
}

// ============================ A09 管理端 ============================
export const adminApi = {
  users: (params) => api.get('/admin/users', { params }),
  setUserStatus: (id, payload, idemKey) =>
    write('put', `/admin/users/${id}/status`, payload, idemKey),
  setCreditLine: (id, payload, idemKey) =>
    write('put', `/admin/users/${id}/credit-line`, payload, idemKey),

  products: (params) => api.get('/admin/products', { params }),
  createProduct: (payload, idemKey) => write('post', '/admin/products', payload, idemKey),
  updateProduct: (id, payload, idemKey) => write('patch', `/admin/products/${id}`, payload, idemKey),
  setProductStatus: (id, payload, idemKey) =>
    write('put', `/admin/products/${id}/status`, payload, idemKey),

  applications: (params) => api.get('/admin/applications', { params }),
  applicationDetail: (id) => api.get(`/admin/applications/${id}`),
  audit: (id, payload, idemKey) => write('post', `/admin/applications/${id}/audit`, payload, idemKey),
  lend: (id, idemKey) => write('post', `/admin/applications/${id}/lend`, null, idemKey),

  blacklist: (params) => api.get('/admin/blacklist', { params }),
  addBlacklist: (userId, payload, idemKey) =>
    write('put', `/admin/blacklist/${userId}`, payload, idemKey),
  removeBlacklist: (userId, idemKey) =>
    write('delete', `/admin/blacklist/${userId}`, null, idemKey),

  overdue: (params) => api.get('/admin/overdue', { params }),
  statistics: () => api.get('/admin/statistics'),

  riskEvaluate: (userId, idemKey) => write('post', '/risk/evaluate', { user_id: userId }, idemKey),
  riskDatasources: () => api.get('/risk/datasources')
}

// ============================ 风控 / 授信（借款人侧） ============================
export const creditApi = {
  score: () => api.get('/credit/score'),
  line: () => api.get('/credit/line'),
  decision: (applicationId) => api.get(`/risk/decision/${applicationId}`)
}

// ============================ A10 幂等结果查询 ============================
export const businessRequestApi = {
  /** 查询某次写操作是否已成功（结果未知时先查这里） */
  result: (operation, key) =>
    api.get('/business-requests/result', { params: { operation, key } })
}

export default {
  authApi,
  userApi,
  productApi,
  applicationApi,
  accountApi,
  repaymentApi,
  fileApi,
  messageApi,
  adminApi,
  creditApi,
  businessRequestApi
}
