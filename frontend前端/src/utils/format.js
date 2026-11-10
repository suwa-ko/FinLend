/**
 * 金额、利率、日期、脱敏等展示层工具
 * 对应《详细设计报告》6.5 共用表现与异常状态：
 *  - 金额格式 ¥12,000.00
 *  - 费率格式 12.00%
 *  - 时刻按北京时间 YYYY-MM-DD HH:mm，日期 YYYY-MM-DD
 *  - 证件号前3后4、手机 138****8888、卡号仅后4
 *
 * 注意：所有金额/利率均以字符串形式从后端获取（避免二进制浮点误差），
 * 前端只做格式化展示，绝不做金额运算。
 */

/** 千分位 + 两位小数，不做四舍五入以外的加工 */
export function fmtMoney(value, { symbol = '¥', fallback = '—' } = {}) {
  if (value === null || value === undefined || value === '') return fallback
  const raw = String(value).trim()
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return fallback
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const [intPart, decPart = ''] = body.split('.')
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const decFmt = (decPart + '00').slice(0, 2)
  return `${neg ? '-' : ''}${symbol}${intFmt}.${decFmt}`
}

/** 百分数展示：后端存的是百分数数值（7.2000 表示 7.2%） */
export function fmtRate(value, { digits = 2, fallback = '—' } = {}) {
  if (value === null || value === undefined || value === '') return fallback
  const raw = String(value).trim()
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return fallback
  return `${Number(raw).toFixed(digits)}%`
}

/** 纯数字千分位（不带货币符号），用于表格 */
export function fmtNumber(value, { fallback = '—' } = {}) {
  return fmtMoney(value, { symbol: '', fallback })
}

const pad = (n) => String(n).padStart(2, '0')

/** 北京时间日期 YYYY-MM-DD */
export function fmtDate(value, fallback = '—') {
  if (!value) return fallback
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 北京时间时刻 YYYY-MM-DD HH:mm */
export function fmtDateTime(value, fallback = '—') {
  if (!value) return fallback
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 解析后端 ISO 8601（带 +08:00）时间串。
 * 后端约定：时间 ISO 8601 并带 +08:00，日期 YYYY-MM-DD。
 */
export function parseServerTime(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 手机号脱敏 138****8888 */
export function maskPhone(phone, fallback = '—') {
  const s = String(phone ?? '').trim()
  if (s.length < 7) return s || fallback
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

/** 证件号前3后4：110***********1234 */
export function maskIdCard(id, fallback = '—') {
  const s = String(id ?? '').trim()
  if (s.length <= 7) return s || fallback
  return `${s.slice(0, 3)}${'*'.repeat(s.length - 7)}${s.slice(-4)}`
}

/** 银行卡仅后4 */
export function maskCardNo(no, fallback = '—') {
  const s = String(no ?? '').replace(/\s+/g, '')
  if (!s) return fallback
  return `**** **** **** ${s.slice(-4)}`
}

/** 姓名脱敏：仅保留姓 */
export function maskName(name, fallback = '—') {
  const s = String(name ?? '').trim()
  if (!s) return fallback
  return `${s[0]}${'*'.repeat(Math.max(1, s.length - 1))}`
}

/** 申请状态中文名，对应《需求分析报告》5.2 申请状态机 */
export const APPLICATION_STATUS = {
  0: { label: '待审核', type: 'warning' },
  1: { label: '待签约', type: 'primary' },
  2: { label: '待放款', type: 'primary' },
  3: { label: '已放款', type: 'success' },
  4: { label: '已结清', type: 'info' },
  5: { label: '已拒绝', type: 'danger' },
  6: { label: '已撤销', type: 'info' },
  7: { label: '已失效', type: 'info' }
}

export function statusLabel(code) {
  return APPLICATION_STATUS[code]?.label ?? '未知状态'
}

export function statusType(code) {
  return APPLICATION_STATUS[code]?.type ?? 'info'
}

/** 还款方式 */
export const REPAY_TYPE = {
  1: '等额本息',
  2: '等额本金',
  3: '先息后本'
}

export function repayTypeLabel(code) {
  return REPAY_TYPE[code] ?? '未知方式'
}

/** 还款计划状态 */
export const PLAN_STATUS = {
  0: { label: '未还', type: 'info' },
  1: { label: '已还', type: 'success' },
  2: { label: '逾期', type: 'danger' }
}

export function planStatusLabel(code) {
  return PLAN_STATUS[code]?.label ?? '未知'
}

/** 倒计时文案：返回 { expired, text } */
export function countdownText(deadline, now = new Date()) {
  const t = parseServerTime(deadline)
  if (!t) return { expired: true, text: '—' }
  const diff = t.getTime() - now.getTime()
  if (diff <= 0) return { expired: true, text: '已超时' }
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return { expired: false, text: `${h} 小时 ${pad(m)} 分 ${pad(s)} 秒` }
}
