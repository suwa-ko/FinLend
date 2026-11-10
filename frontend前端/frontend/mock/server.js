/**
 * Mock 服务（开发期替代后端）
 *
 * 依据《详细设计报告》5.2 响应协议与 5.3 接口清单构造：
 *  - 前缀 /api/v1
 *  - 成功 { code: 0, message: "成功", data: ... }
 *  - 失败 { code: "<业务码>", message, data }
 *  - 金额/利率/ID 字符串；时间 ISO 8601 带 +08:00
 *  - 业务日 Asia/Shanghai
 *
 * 说明：本 Mock 用于前端联调与演示，业务规则（利息、罚息、结清）
 * 按《需求分析报告》6.1–6.3 的算例实现，便于核对前端展示。
 * 它不替代后端实现，也不作为验收证据。
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT || 8301)
const PREFIX = '/api/v1'

// ------------------------------------------------------------------
// 工具
// ------------------------------------------------------------------
const nowIso = () =>
  new Date(Date.now() + 8 * 3600e3).toISOString().replace('Z', '+08:00').replace(/\.\d+/, '')

/** 任意时刻 → 北京时间 ISO 8601（带 +08:00），符合后端时间契约 */
const isoBeijing = (d) =>
  new Date(d.getTime() + 8 * 3600e3).toISOString().replace('Z', '+08:00').replace(/\.\d+/, '')

const today = () => nowIso().slice(0, 10)

function ok(data = null, message = '成功') {
  return { code: 0, message, data }
}

function fail(code, message, data = null) {
  return { code, message, data }
}

function addMonthsClamped(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const money = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2)

/** 期数 × 12 期等额本息/等额本金/先息后本，按《需求分析报告》6.1 */
function buildSchedule(principal, annualRate, term, repayType) {
  const P = Number(principal)
  const monthlyRate = Number(annualRate) / 100 / 12
  const rows = []

  if (repayType === 3) {
    // 先息后本
    for (let i = 1; i <= term; i += 1) {
      const interest = monthRound(P * monthlyRate)
      rows.push({
        term_no: i,
        principal: i === term ? P.toFixed(2) : '0.00',
        interest: interest.toFixed(2),
        amount: (i === term ? P + interest : interest).toFixed(2)
      })
    }
    return rows
  }

  if (repayType === 2) {
    // 等额本金
    const baseP = monthRound(P / term)
    let remain = P
    for (let i = 1; i <= term; i += 1) {
      const p = i === term ? remain : baseP
      const interest = monthRound(remain * monthlyRate)
      rows.push({
        term_no: i,
        principal: p.toFixed(2),
        interest: interest.toFixed(2),
        amount: (p + interest).toFixed(2)
      })
      remain = monthRound(remain - p)
    }
    return rows
  }

  // 等额本息
  if (monthlyRate === 0) {
    const p = monthRound(P / term)
    for (let i = 1; i <= term; i += 1) {
      const principalPart = i === term ? P - p * (term - 1) : p
      rows.push({
        term_no: i,
        principal: principalPart.toFixed(2),
        interest: '0.00',
        amount: principalPart.toFixed(2)
      })
    }
    return rows
  }
  const pow = Math.pow(1 + monthlyRate, term)
  const monthly = monthRound((P * monthlyRate * pow) / (pow - 1))
  let remain = P
  for (let i = 1; i <= term; i += 1) {
    const interest = monthRound(remain * monthlyRate)
    const principalPart = i === term ? remain : monthRound(monthly - interest)
    rows.push({
      term_no: i,
      principal: principalPart.toFixed(2),
      interest: interest.toFixed(2),
      amount: (principalPart + interest).toFixed(2)
    })
    remain = monthRound(remain - principalPart)
  }
  return rows
}

function monthRound(n) {
  // 等价于 ROUND_HALF_UP 保留两位（避免二进制浮点构造 Decimal）
  const s = Number(n).toFixed(10)
  const v = Math.round(Number(s) * 100 + (Number(s) >= 0 ? 1e-6 : -1e-6)) / 100
  return v
}

// ------------------------------------------------------------------
// 内存数据（seed）
// ------------------------------------------------------------------
const state = {
  users: [],
  admins: [],
  products: [],
  applications: [],
  plans: [],
  orders: [],
  messages: [],
  flows: [],
  bankCards: [],
  blacklist: [],
  files: new Map(), // fileId -> {ownerId, name, mime, buffer}
  refreshTokens: new Map(), // token -> {sid, subject, subjectType, expiresAt}
  idem: new Map(), // key -> {operation, content, response, subject}
  seq: { user: 1, app: 1, plan: 1, order: 1, msg: 1, flow: 1, product: 1, card: 1, file: 1 }
}

function seed() {
  // 管理员
  state.admins.push({
    id: '1',
    username: 'admin',
    password: 'admin123',
    display_name: '系统管理员',
    role: 'ADMIN'
  })

  // 演示借款人：已验证实名、有余额
  const demo = {
    id: '2',
    username: 'demo_user',
    phone: '13800138000',
    password: 'demo1234',
    display_name: '演示用户',
    verified: true,
    frozen: false,
    credit_line: '50000.00',
    balance: '50000.00',
    real_name: '演示用户',
    id_card: '110101199001011234',
    created_at: nowIso()
  }
  state.users.push(demo)
  state.seq.user = 3
  // 初始化流水（seed 资金，不是真实充值）
  addFlow(demo.id, '50000.00', '种子初始化演示资金', 'INIT-0001', 'IN')

  // 未实名用户，用于演示「未实名不能申请」
  state.users.push({
    id: '3',
    username: 'newbie',
    phone: '13900139000',
    password: 'newbie1234',
    display_name: '新注册用户',
    verified: false,
    frozen: false,
    credit_line: '50000.00',
    balance: '0.00',
    real_name: '',
    id_card: '',
    created_at: nowIso()
  })
  state.seq.user = 4

  // 产品：每种还款方式一个
  const products = [
    { name: '安心借·等额本息', repay_type: 1, annual_rate: '12.0000', min_amount: '1000.00', max_amount: '50000.00', min_term: 3, max_term: 24 },
    { name: '稳盈借·等额本金', repay_type: 2, annual_rate: '10.0000', min_amount: '1000.00', max_amount: '50000.00', min_term: 3, max_term: 24 },
    { name: '轻享借·先息后本', repay_type: 3, annual_rate: '9.0000', min_amount: '1000.00', max_amount: '50000.00', min_term: 3, max_term: 12 }
  ]
  products.forEach((p, i) => {
    state.products.push({
      id: String(i + 1),
      ...p,
      status: 1,
      penalty_daily_rate: '0.0500',
      prepay_fee_rate: '0.0000',
      description: '课程演示产品，虚构数据，不代表真实借贷产品',
      created_at: nowIso()
    })
  })
  state.seq.product = 4

  // 演示消息
  addMessage(demo.id, 'WELCOME', '欢迎使用 FinLend', '这是一个课程演示平台，所有身份与资金均为虚构。')
}

function addFlow(userId, amount, remark, bizNo, direction) {
  const user = state.users.find((u) => u.id === userId)
  if (!user) return null
  if (direction === 'IN') user.balance = money(Number(user.balance) + Number(amount))
  else user.balance = money(Number(user.balance) - Number(amount))
  const flow = {
    id: String(state.seq.flow++),
    biz_no: bizNo,
    direction,
    amount: money(amount),
    balance_after: user.balance,
    remark,
    created_at: nowIso()
  }
  state.flows.push({ user_id: userId, ...flow })
  return flow
}

function addMessage(userId, eventKey, title, content) {
  if (state.messages.some((m) => m.user_id === userId && m.event_key === eventKey)) return
  state.messages.push({
    id: String(state.seq.msg++),
    user_id: userId,
    event_key: eventKey,
    title,
    content,
    is_read: false,
    created_at: nowIso()
  })
}

// ------------------------------------------------------------------
// 鉴权
// ------------------------------------------------------------------
function issueTokens(subject, subjectType) {
  const sid = randomUUID().replace(/-/g, '')
  const access = `${subjectType}:${subject}:${sid}`
  const refresh = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  state.refreshTokens.set(refresh, {
    sid,
    subject,
    subjectType,
    expiresAt: Date.now() + 7 * 24 * 3600e3
  })
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: 7200,
    sid
  }
}

function currentSubject(req) {
  const auth = req.headers.authorization || ''
  const m = /^Bearer (user|admin):(\d+):([a-f0-9]*)$/.exec(auth)
  if (!m) return null
  return { type: m[1], id: m[2], sid: m[3] }
}

function currentUser(req) {
  const sub = currentSubject(req)
  if (!sub || sub.type !== 'user') return null
  const u = state.users.find((x) => x.id === sub.id)
  if (!u || u.frozen) return null
  return u
}

function currentAdmin(req) {
  const sub = currentSubject(req)
  if (!sub || sub.type !== 'admin') return null
  return state.admins.find((a) => a.id === sub.id) || null
}

// ------------------------------------------------------------------
// 路由实现
// ------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      if (!raw.length) return resolve({ raw, json: {} })
      if ((req.headers['content-type'] || '').includes('multipart/form-data')) {
        return resolve({ raw, json: {} })
      }
      try {
        resolve({ raw, json: JSON.parse(raw.toString('utf8')) })
      } catch {
        resolve({ raw, json: {} })
      }
    })
  })
}

function paginate(list, query) {
  const offset = Math.max(0, Number(query.get('offset') || 0))
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 20)))
  return {
    items: list.slice(offset, offset + limit),
    total: list.length,
    offset,
    limit
  }
}

function publicUser(u) {
  return {
    user_id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    phone: u.phone,
    verified: u.verified,
    frozen: u.frozen,
    credit_line: u.credit_line,
    balance: u.balance,
    real_name: u.verified ? u.real_name : '',
    id_card: u.verified ? u.id_card : '',
    created_at: u.created_at
  }
}

function adminUserView(u) {
  const occupied = occupiedCredit(u.id)
  return {
    user_id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    phone: u.phone,
    verified: u.verified,
    frozen: u.frozen,
    credit_line: u.credit_line,
    occupied_credit: occupied,
    available_credit: money(Math.max(0, Number(u.credit_line) - Number(occupied))),
    balance: u.balance,
    blacklisted: state.blacklist.some((b) => b.user_id === u.id),
    created_at: u.created_at
  }
}

function occupiedCredit(userId) {
  const activeApps = state.applications.filter(
    (a) => a.user_id === userId && (a.status === 3 || a.status === 4)
  )
  let sum = 0
  for (const app of activeApps) {
    const plans = state.plans.filter((p) => p.application_id === app.id)
    for (const p of plans) {
      if (p.status !== 1) sum += Number(p.remaining_principal)
    }
  }
  return money(sum)
}

function appView(a) {
  const user = state.users.find((u) => u.id === a.user_id)
  return {
    application_id: a.id,
    apply_no: a.apply_no,
    user_id: a.user_id,
    username: user?.username,
    display_name: user?.display_name,
    product_id: a.product_id,
    product_name: state.products.find((p) => p.id === a.product_id)?.name,
    amount: a.amount,
    term: a.term,
    purpose: a.purpose,
    status: a.status,
    rule_snapshot: a.rule_snapshot,
    audit_opinion: a.audit_opinion || '',
    sign_deadline: a.sign_deadline || '',
    created_at: a.created_at,
    updated_at: a.updated_at
  }
}

function planView(p) {
  return {
    plan_id: p.plan_id,
    application_id: p.application_id,
    term_no: p.term_no,
    due_date: p.due_date,
    principal: p.principal,
    interest: p.interest,
    penalty: p.penalty,
    paid_principal: p.paid_principal,
    paid_interest: p.paid_interest,
    remaining_principal: p.remaining_principal,
    waived_interest: p.waived_interest || '0.00',
    status: p.status,
    overdue_days: p.overdue_days || 0
  }
}

async function handle(req, res, url) {
  const path = url.pathname.replace(PREFIX, '')
  const query = url.searchParams
  const method = req.method.toUpperCase()
  const { json: body, raw } = await readBody(req)
  const idemKey = req.headers['idempotency-key'] || ''

  const match = (pattern) => {
    const m = pattern.exec(path)
    return m ? m.slice(1) : null
  }

  // ---------------- A01 认证 ----------------
  if (path === '/auth/code' && method === 'POST') {
    if (!/^1\d{10}$/.test(body.phone || '')) return [422, fail('VALIDATION_ERROR', '手机号格式不正确')]
    return [200, ok({ code: '888888', expires_in: 300, is_mock: true }, '演示验证码已生成')]
  }

  if (path === '/auth/register' && method === 'POST') {
    const { username, phone, password, code } = body
    if (!username || !phone || !password) return [422, fail('VALIDATION_ERROR', '账号、手机号、密码均为必填')]
    if (code !== '888888') return [422, fail('VALIDATION_ERROR', '验证码错误（演示环境固定为 888888）')]
    if (state.users.some((u) => u.username === username)) return [409, fail('STATE_CONFLICT', '账号已存在')]
    if (state.users.some((u) => u.phone === phone)) return [409, fail('STATE_CONFLICT', '手机号已被注册')]
    const u = {
      id: String(state.seq.user++),
      username,
      phone,
      password,
      display_name: username,
      verified: false,
      frozen: false,
      credit_line: '50000.00',
      balance: '0.00',
      real_name: '',
      id_card: '',
      created_at: nowIso()
    }
    state.users.push(u)
    addMessage(u.id, `REG-${u.id}`, '注册成功', '请先完成模拟实名认证后再申请借款。')
    return [201, ok({ user_id: u.id }, '注册成功')]
  }

  if ((path === '/auth/login' || path === '/admin/auth/login') && method === 'POST') {
    const { username, password } = body
    if (path === '/auth/login') {
      const u = state.users.find((x) => x.username === username)
      if (!u || u.password !== password) return [401, fail('AUTH_REQUIRED', '账号或密码错误')]
      if (u.frozen) return [403, fail('FORBIDDEN', '账号已被冻结）')]
      return [200, ok(issueTokens(u.id, 'user'))]
    }
    const a = state.admins.find((x) => x.username === username)
    if (!a || a.password !== password) return [401, fail('AUTH_REQUIRED', '管理员账号或密码错误')]
    return [200, ok(issueTokens(a.id, 'admin'))]
  }

  if (path === '/auth/refresh' && method === 'POST') {
    const rec = state.refreshTokens.get(body.refresh_token)
    if (!rec || rec.expiresAt < Date.now()) return [401, fail('AUTH_REQUIRED', '刷新令牌无效或已过期')]
    state.refreshTokens.delete(body.refresh_token) // 轮换
    return [200, ok(issueTokens(rec.subject, rec.subjectType)) ]
  }

  if (path === '/auth/logout' && method === 'POST') {
    const sub = currentSubject(req)
    if (sub) {
      for (const [k, v] of state.refreshTokens) if (v.sid === sub.sid) state.refreshTokens.delete(k)
    }
    return [200, ok(null, '已退出')]
  }

  // ---------------- A02 用户资料 ----------------
  if (path === '/users/me' && method === 'GET') {
    const u = currentUser(req) || (currentAdmin(req) ? state.admins[0] : null)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    if (currentAdmin(req)) {
      return [200, ok({ user_id: u.id, username: u.username, display_name: u.display_name, is_admin: true })]
    }
    return [200, ok(publicUser(u))]
  }

  if (path === '/users/me' && method === 'PATCH') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    if (body.display_name) u.display_name = String(body.display_name).slice(0, 30)
    return [200, ok(publicUser(u), '资料已更新')]
  }

  if (path === '/users/me/identity' && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const { real_name, id_card, file_id } = body
    if (!real_name) return [422, fail('VALIDATION_ERROR', '请填写姓名')]
    if (!/^\d{17}[\dXx]$/.test(id_card || '')) return [422, fail('VALIDATION_ERROR', '证件号须为 18 位')]
    if (!file_id) return [422, fail('VALIDATION_ERROR', '请先上传测试证件图片')]
    u.real_name = real_name
    u.id_card = id_card
    u.verified = true
    addMessage(u.id, `IDV-${u.id}`, '模拟实名完成', '您已完成模拟实名认证（非真实身份核验）。')
    return [200, ok({ verified: true, is_mock: true }, '模拟实名认证成功（非真实核验）')]
  }

  if (path === '/users/me/bank-cards' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    return [200, ok(state.bankCards.filter((c) => c.user_id === u.id))]
  }

  if (path === '/users/me/bank-cards' && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    if (!/^\d{16,19}$/.test(String(body.card_no || '').replace(/\s/g, ''))) {
      return [422, fail('VALIDATION_ERROR', '卡号须为 16–19 位数字')]
    }
    const mine = state.bankCards.filter((c) => c.user_id === u.id)
    if (mine.some((c) => c.card_no === body.card_no)) return [409, fail('STATE_CONFLICT', '该模拟卡已绑定')]
    const card = {
      card_id: String(state.seq.card++),
      user_id: u.id,
      card_no: body.card_no,
      bank_name: body.bank_name || '模拟银行',
      is_default: mine.length === 0
    }
    state.bankCards.push(card)
    return [201, ok(card, '模拟卡已绑定（不参与资金划转）')]
  }

  let m = match(/^\/users\/me\/bank-cards\/(\d+)$/)
  if (m && method === 'DELETE') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const idx = state.bankCards.findIndex((c) => c.card_id === m[0] && c.user_id === u.id)
    if (idx < 0) return [404, fail('NOT_FOUND', '模拟卡不存在')]
    state.bankCards.splice(idx, 1)
    return [200, ok(null, '已删除')]
  }

  m = match(/^\/users\/me\/bank-cards\/(\d+)\/default$/)
  if (m && method === 'PUT') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    state.bankCards
      .filter((c) => c.user_id === u.id)
      .forEach((c) => {
        c.is_default = c.card_id === m[0]
      })
    return [200, ok(null, '默认卡已更新（仅一张）')]
  }

  // ---------------- A03 产品与试算 ----------------
  if (path === '/products' && method === 'GET') {
    return [200, ok(state.products.filter((p) => p.status === 1))]
  }

  m = match(/^\/products\/(\d+)$/)
  if (m && method === 'GET') {
    const p = state.products.find((x) => x.id === m[0])
    if (!p) return [404, fail('NOT_FOUND', '产品不存在')]
    return [200, ok(p)]
  }

  if (path === '/loans/quote' && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const p = state.products.find((x) => x.id === String(body.product_id))
    if (!p) return [404, fail('NOT_FOUND', '产品不存在')]
    const amount = Number(body.amount)
    const term = Number(body.term)
    if (!(amount > 0) || !(term > 0)) return [422, fail('VALIDATION_ERROR', '金额与期数须为正数')]
    if (amount < Number(p.min_amount) || amount > Number(p.max_amount)) {
      return [422, fail('VALIDATION_ERROR', `金额须在 ${p.min_amount}–${p.max_amount} 之间`)]
    }
    if (term < p.min_term || term > p.max_term) {
      return [422, fail('VALIDATION_ERROR', `期数须在 ${p.min_term}–${p.max_term} 之间`)]
    }
    const schedule = buildSchedule(amount, p.annual_rate, term, p.repay_type)
    const totalInterest = schedule.reduce((s, r) => s + Number(r.interest), 0)
    const totalAmount = schedule.reduce((s, r) => s + Number(r.amount), 0)
    return [
      200,
      ok({
        product_id: p.id,
        amount: money(amount),
        term,
        annual_rate: p.annual_rate,
        repay_type: p.repay_type,
        total_interest: money(totalInterest),
        total_amount: money(totalAmount),
        first_due_date: addMonthsClamped(today(), 1),
        note: '实际到期日以放款后生成的还款计划为准',
        schedule
      })
    ]
  }

  // ---------------- A04 申请 ----------------
  if (path === '/applications' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const list = state.applications
      .filter((a) => a.user_id === u.id)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map(appView)
    return [200, ok(paginate(list, query))]
  }

  if (path === '/applications' && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    if (!idemKey) return [422, fail('VALIDATION_ERROR', '写操作缺少 Idempotency-Key')]
    const cached = state.idem.get(idemKey)
    if (cached) {
      if (JSON.stringify(cached.content) !== JSON.stringify(body)) {
        return [409, fail('IDEMPOTENCY_CONFLICT', '相同幂等键但内容不同')]
      }
      return [200, ok(cached.response)]
    }
    if (!u.verified) return [403, fail('FORBIDDEN', '未完成模拟实名，不能申请')]
    if (state.blacklist.some((b) => b.user_id === u.id)) {
      return [403, fail('FORBIDDEN', '您当前在黑名单中，暂不能申请')]
    }
    if (state.applications.some((a) => a.user_id === u.id && a.status === 0)) {
      return [409, fail('STATE_CONFLICT', '同一用户最多一笔待审核申请')]
    }
    const p = state.products.find((x) => x.id === String(body.product_id))
    if (!p || p.status !== 1) return [409, fail('STATE_CONFLICT', '产品不存在或已下架')]
    const amount = Number(body.amount)
    const term = Number(body.term)
    if (amount < Number(p.min_amount) || amount > Number(p.max_amount)) {
      return [422, fail('VALIDATION_ERROR', `金额须在 ${p.min_amount}–${p.max_amount} 之间`)]
    }
    if (term < p.min_term || term > p.max_term) {
      return [422, fail('VALIDATION_ERROR', `期数须在 ${p.min_term}–${p.max_term} 之间`)]
    }
    const available = Number(u.credit_line) - Number(occupiedCredit(u.id))
    if (amount > available) return [409, fail('INSUFFICIENT_CREDIT', '可用授信额度不足')]
    if (String(body.purpose || '').length > 200) return [422, fail('VALIDATION_ERROR', '用途不超过 200 字')]

    const app = {
      id: String(state.seq.app++),
      apply_no: `LN${String(state.seq.app).padStart(6, '0')}`,
      user_id: u.id,
      product_id: p.id,
      amount: money(amount),
      term,
      purpose: body.purpose || '',
      status: 0,
      rule_snapshot: {
        annual_rate: p.annual_rate,
        repay_type: p.repay_type,
        penalty_daily_rate: p.penalty_daily_rate,
        prepay_fee_rate: p.prepay_fee_rate,
        min_amount: p.min_amount,
        max_amount: p.max_amount,
        term
      },
      created_at: nowIso(),
      updated_at: nowIso()
    }
    state.applications.push(app)
    const payload = appView(app)
    state.idem.set(idemKey, { operation: 'APPLICATION_CREATE', content: body, response: payload, subject: u.id })
    return [201, ok(payload, '申请已提交，等待审核')]
  }

  m = match(/^\/applications\/(\d+)$/)
  if (m && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    return [200, ok(appView(a))]
  }

  m = match(/^\/applications\/(\d+)\/cancel$/)
  if (m && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (a.status !== 0) return [409, fail('STATE_CONFLICT', '只有待审核状态可撤销')]
    a.status = 6
    a.updated_at = nowIso()
    addMessage(u.id, `CANCEL-${a.id}`, '申请已撤销', `申请 ${a.apply_no} 已撤销。`)
    return [200, ok(appView(a), '申请已撤销')]
  }

  m = match(/^\/applications\/(\d+)\/sign$/)
  if (m && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (a.status !== 1) return [409, fail('STATE_CONFLICT', '只有待签约状态可签约')]
    if (new Date(a.sign_deadline).getTime() < Date.now()) {
      a.status = 7
      return [409, fail('STATE_CONFLICT', '签约已超时，申请已失效')]
    }
    if (!body.confirmed) return [422, fail('VALIDATION_ERROR', '请确认规则快照')]
    a.status = 2
    a.updated_at = nowIso()
    addMessage(u.id, `SIGN-${a.id}`, '签约成功', `申请 ${a.apply_no} 已签约，等待放款。`)
    return [200, ok(appView(a), '签约成功')]
  }

  // ---------------- A05 账户 ----------------
  if (path === '/accounts/me' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const occupied = occupiedCredit(u.id)
    return [
      200,
      ok({
        balance: u.balance,
        credit_line: u.credit_line,
        occupied_credit: occupied,
        available_credit: money(Math.max(0, Number(u.credit_line) - Number(occupied)))
      })
    ]
  }

  if (path === '/accounts/me/flows' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const list = state.flows
      .filter((f) => f.user_id === u.id)
      .sort((a, b) => Number(b.id) - Number(a.id))
    return [200, ok(paginate(list, query))]
  }

  // ---------------- A06 还款 ----------------
  m = match(/^\/applications\/(\d+)\/plans$/)
  if (m && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    const plans = state.plans
      .filter((p) => p.application_id === a.id)
      .sort((x, y) => x.term_no - y.term_no)
      .map(planView)
    return [200, ok(plans)]
  }

  m = match(/^\/applications\/(\d+)\/repayments$/)
  if (m && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const orders = state.orders
      .filter((o) => o.application_id === m[0] && o.user_id === u.id)
      .sort((a, b) => Number(b.order_id) - Number(a.order_id))
    return [200, ok(orders)]
  }

  m = match(/^\/applications\/(\d+)\/repay$/)
  if (m && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (!a.plans_generated) return [409, fail('STATE_CONFLICT', '尚未放款，无还款计划')]
    if (!idemKey) return [422, fail('VALIDATION_ERROR', '写操作缺少 Idempotency-Key')]
    const cached = state.idem.get(idemKey)
    if (cached) return [200, ok(cached.response, '重复请求返回原结果')]

    const plans = state.plans
      .filter((p) => p.application_id === a.id && p.status !== 1)
      .sort((x, y) => x.term_no - y.term_no)
    const target = plans[0]
    if (!target) return [409, fail('STATE_CONFLICT', '没有待还期次')]
    const due = Number(target.remaining_principal) + Number(target.interest) + Number(target.penalty)
    if (body.confirm_amount !== undefined && money(body.confirm_amount) !== money(due)) {
      return [409, fail('AMOUNT_CHANGED', '确认金额与当前应还额不一致，请刷新后重新确认')]
    }
    if (Number(u.balance) < due) return [409, fail('INSUFFICIENT_BALANCE', '账户余额不足')]

    const repayNo = `RP${Date.now()}`
    target.paid_principal = target.principal
    target.paid_interest = target.interest
    target.remaining_principal = '0.00'
    target.status = 1
    addFlow(u.id, due, `还款 ${repayNo}`, repayNo, 'OUT')
    const order = {
      order_id: String(state.seq.order++),
      repay_no: repayNo,
      application_id: a.id,
      user_id: u.id,
      amount: money(due),
      principal: target.principal,
      interest: target.interest,
      penalty: target.penalty,
      balance_after: u.balance,
      created_at: nowIso()
    }
    state.orders.push(order)
    const remaining = state.plans.filter((p) => p.application_id === a.id && p.status !== 1)
    if (!remaining.length) {
      a.status = 4
      addMessage(u.id, `SETTLE-${a.id}`, '借款已结清', `申请 ${a.apply_no} 已全部结清。`)
    }
    addMessage(u.id, `REPAY-${order.order_id}`, '还款成功', `第 ${target.term_no} 期已还清，金额 ${money(due)}。`)
    const payload = { ...order }
    state.idem.set(idemKey, { operation: 'REPAY', content: body, response: payload, subject: u.id })
    return [200, ok(payload, '还款成功')]
  }

  m = match(/^\/applications\/(\d+)\/settlement-quote$/)
  if (m && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (!a.plans_generated || a.status !== 3) return [409, fail('STATE_CONFLICT', '当前借款不可提前结清')]
    const plans = state.plans.filter((p) => p.application_id === a.id && p.status !== 1)
    const principal = plans.reduce((s, p) => s + Number(p.remaining_principal), 0)
    // 到期（含当日）计划的未还利息与罚息；未到期利息记为减免，不向用户收取
    const duePlans = plans.filter((p) => p.due_date <= today())
    const dueInterest = duePlans.reduce((s, p) => s + Number(p.interest), 0)
    const penalty = plans.reduce((s, p) => s + Number(p.penalty), 0)
    const allInterest = plans.reduce((s, p) => s + Number(p.interest), 0)
    const waived = allInterest - dueInterest
    const prepayFee = (principal * Number(a.rule_snapshot.prepay_fee_rate)) / 100
    const total = principal + dueInterest + penalty + prepayFee
    return [
      200,
      ok({
        business_date: today(),
        principal: money(principal),
        due_interest: money(dueInterest),
        penalty: money(penalty),
        current_interest: '0.00',
        prepay_fee: money(prepayFee),
        total_amount: money(total),
        waived_interest: money(waived)
      })
    ]
  }

  m = match(/^\/applications\/(\d+)\/settle$/)
  if (m && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (!idemKey) return [422, fail('VALIDATION_ERROR', '写操作缺少 Idempotency-Key')]
    const cached = state.idem.get(idemKey)
    if (cached) return [200, ok(cached.response, '重复请求返回原结果')]
    const plans = state.plans.filter((p) => p.application_id === a.id && p.status !== 1)
    if (!plans.length) return [409, fail('STATE_CONFLICT', '借款已结清')]
    const principal = plans.reduce((s, p) => s + Number(p.remaining_principal), 0)
    const duePlans = plans.filter((p) => p.due_date <= today())
    const dueInterest = duePlans.reduce((s, p) => s + Number(p.interest), 0)
    const penalty = plans.reduce((s, p) => s + Number(p.penalty), 0)
    const prepayFee = (principal * Number(a.rule_snapshot.prepay_fee_rate)) / 100
    // 与报价口径完全一致：本金 + 到期利息罚息 + 结清费
    const total = principal + dueInterest + penalty + prepayFee
    if (money(body.confirm_amount) !== money(total)) {
      return [409, fail('AMOUNT_CHANGED', '报价已变化，请重新获取结清报价')]
    }
    if (Number(u.balance) < total) return [409, fail('INSUFFICIENT_BALANCE', '账户余额不足')]
    plans.forEach((p) => {
      p.waived_interest = p.interest
      p.paid_principal = p.principal
      p.remaining_principal = '0.00'
      p.status = 1
    })
    addFlow(u.id, total, '提前结清', `ST${a.id}`, 'OUT')
    a.status = 4
    const order = {
      order_id: String(state.seq.order++),
      repay_no: `ST${a.id}`,
      application_id: a.id,
      user_id: u.id,
      amount: money(total),
      principal: money(principal),
      interest: money(dueInterest),
      penalty: money(penalty),
      balance_after: u.balance,
      created_at: nowIso()
    }
    state.orders.push(order)
    addMessage(u.id, `SETTLE-${a.id}`, '借款已结清', `申请 ${a.apply_no} 已整笔结清（提前结清）。`)
    state.idem.set(idemKey, { operation: 'SETTLE', content: body, response: order, subject: u.id })
    return [200, ok(order, '提前结清成功')]
  }

  // ---------------- A07 文件 ----------------
  if (path === '/files' && method === 'POST') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const ct = req.headers['content-type'] || ''
    const boundary = /boundary=(.+)$/.exec(ct)?.[1]
    if (!boundary) return [415, fail('FILE_TYPE_INVALID', '仅接受 multipart 上传')]
    const headerEnd = raw.indexOf('\r\n\r\n')
    const fileStart = headerEnd + 4
    const tail = raw.lastIndexOf(`\r\n--${boundary}`)
    if (headerEnd < 0 || tail <= fileStart) return [415, fail('FILE_TYPE_INVALID', '未接收到文件')]
    const head = raw.slice(0, headerEnd).toString('latin1')
    const mime = /Content-Type:\s*(image\/\w+)/i.exec(head)?.[1] || 'application/octet-stream'
    const name = /filename="([^"]*)"/i.exec(head)?.[1] || 'upload'
    if (!/^image\/(jpeg|png)$/.test(mime)) return [415, fail('FILE_TYPE_INVALID', '仅接受 JPEG / PNG')]
    const buf = raw.slice(fileStart, tail)
    if (buf.length > 5 * 1024 * 1024) return [413, fail('FILE_TOO_LARGE', '文件超过 5 MiB')]
    const id = String(state.seq.file++)
    state.files.set(id, { ownerId: u.id, name, mime, buffer: buf })
    return [201, ok({ file_id: id, name, size: buf.length, mime }, '上传成功')]
  }

  m = match(/^\/files\/(\d+)$/)
  if (m && method === 'GET') {
    const rec = state.files.get(m[0])
    if (!rec) return [404, fail('NOT_FOUND', '文件不存在')]
    const sub = currentSubject(req)
    const isOwner = sub && sub.type === 'user' && sub.id === rec.ownerId
    const isAdmin = sub && sub.type === 'admin'
    if (!isOwner && !isAdmin) return [403, fail('FORBIDDEN', '无权读取该文件')]
    res.writeHead(200, { 'Content-Type': rec.mime, 'Cache-Control': 'no-store' })
    res.end(rec.buffer)
    return null
  }

  // ---------------- A08 消息 ----------------
  if (path === '/messages' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const list = state.messages
      .filter((x) => x.user_id === u.id)
      .sort((a, b) => Number(b.id) - Number(a.id))
    return [200, ok(paginate(list, query))]
  }

  if (path === '/messages/unread-count' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    return [200, ok({ unread: state.messages.filter((x) => x.user_id === u.id && !x.is_read).length })]
  }

  m = match(/^\/messages\/(\d+)\/read$/)
  if (m && method === 'PUT') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const msg = state.messages.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!msg) return [404, fail('NOT_FOUND', '消息不存在')]
    msg.is_read = true
    return [200, ok({ unread: state.messages.filter((x) => x.user_id === u.id && !x.is_read).length })]
  }

  // ---------------- 风控 / 授信 ----------------
  if (path === '/credit/score' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    return [200, ok({ score: 60, level: 'C', is_mock: true, engine_version: 'mock-1.0' })]
  }

  if (path === '/credit/line' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    return [200, ok({ credit_line: u.credit_line })]
  }

  m = match(/^\/risk\/decision\/(\d+)$/)
  if (m && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const a = state.applications.find((x) => x.id === m[0] && x.user_id === u.id)
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    return [200, ok({ decision: 'PASS', score: 60, level: 'C', credit_line: u.credit_line, is_mock: true })]
  }

  // ---------------- A09 管理端 ----------------
  if (path === '/admin/users' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const kw = (query.get('keyword') || '').trim()
    let list = state.users.map(adminUserView)
    if (kw) {
      list = list.filter(
        (u) => u.username.includes(kw) || u.phone.includes(kw) || (u.display_name || '').includes(kw)
      )
    }
    return [200, ok(paginate(list, query))]
  }

  m = match(/^\/admin\/users\/(\d+)\/status$/)
  if (m && method === 'PUT') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const u = state.users.find((x) => x.id === m[0])
    if (!u) return [404, fail('NOT_FOUND', '用户不存在')]
    u.frozen = Boolean(body.frozen)
    addMessage(u.id, `FREEZE-${u.id}-${u.frozen}`, u.frozen ? '账号已冻结' : '账号已解冻',
      u.frozen ? '账号已冻结，既有债务仍将继续计费。' : '账号已解冻，可正常登录与还款。')
    return [200, ok(adminUserView(u), u.frozen ? '已冻结' : '已解冻')]
  }

  m = match(/^\/admin\/users\/(\d+)\/credit-line$/)
  if (m && method === 'PUT') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const u = state.users.find((x) => x.id === m[0])
    if (!u) return [404, fail('NOT_FOUND', '用户不存在')]
    const line = Number(body.credit_line)
    if (!(line >= 0)) return [422, fail('VALIDATION_ERROR', '授信额度须为非负数')]
    if (line < Number(occupiedCredit(u.id))) {
      return [409, fail('STATE_CONFLICT', '授信额度不能低于当前已占用额度')]
    }
    u.credit_line = money(line)
    return [200, ok(adminUserView(u), '授信额度已更新')]
  }

  if (path === '/admin/products' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    return [200, ok(paginate(state.products, query))]
  }

  if (path === '/admin/products' && method === 'POST') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const err = validateProduct(body)
    if (err) return [422, fail('VALIDATION_ERROR', err)]
    const p = {
      id: String(state.seq.product++),
      ...body,
      status: body.status ?? 1,
      created_at: nowIso()
    }
    state.products.push(p)
    return [201, ok(p, '产品已创建')]
  }

  m = match(/^\/admin\/products\/(\d+)$/)
  if (m && method === 'PATCH') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const p = state.products.find((x) => x.id === m[0])
    if (!p) return [404, fail('NOT_FOUND', '产品不存在')]
    const err = validateProduct({ ...p, ...body })
    if (err) return [422, fail('VALIDATION_ERROR', err)]
    Object.assign(p, body)
    return [200, ok(p, '产品已更新（不影响已有申请快照）')]
  }

  m = match(/^\/admin\/products\/(\d+)\/status$/)
  if (m && method === 'PUT') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const p = state.products.find((x) => x.id === m[0])
    if (!p) return [404, fail('NOT_FOUND', '产品不存在')]
    p.status = Number(body.status) === 1 ? 1 : 0
    return [200, ok(p, p.status === 1 ? '已上架' : '已下架（不能新增申请）')]
  }

  if (path === '/admin/applications' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    let list = state.applications.slice().sort((a, b) => Number(b.id) - Number(a.id))
    const status = query.get('status')
    if (status !== null && status !== '' && status !== 'all') {
      list = list.filter((a) => String(a.status) === String(status))
    }
    return [200, ok(paginate(list.map(appView), query))]
  }

  m = match(/^\/admin\/applications\/(\d+)$/)
  if (m && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const a = state.applications.find((x) => x.id === m[0])
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    return [200, ok(appView(a))]
  }

  m = match(/^\/admin\/applications\/(\d+)\/audit$/)
  if (m && method === 'POST') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const a = state.applications.find((x) => x.id === m[0])
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (a.status !== 0) return [409, fail('STATE_CONFLICT', '仅待审核状态可审批')]
    if (!['APPROVE', 'REJECT'].includes(body.decision)) {
      return [422, fail('VALIDATION_ERROR', 'decision 须为 APPROVE 或 REJECT')]
    }
    if (body.decision === 'REJECT' && !String(body.opinion || '').trim()) {
      return [422, fail('VALIDATION_ERROR', '拒绝原因必填')]
    }
    a.audit_opinion = body.opinion || ''
    a.updated_at = nowIso()
    if (body.decision === 'APPROVE') {
      a.status = 1
      a.sign_deadline = isoBeijing(new Date(Date.now() + 72 * 3600e3))
      addMessage(a.user_id, `AUDIT-${a.id}`, '申请已通过', `申请 ${a.apply_no} 已通过，请在 72 小时内完成签约。`)
    } else {
      a.status = 5
      addMessage(a.user_id, `AUDIT-${a.id}`, '申请被拒绝', `原因：${a.audit_opinion}`)
    }
    return [200, ok(appView(a), body.decision === 'APPROVE' ? '已通过' : '已拒绝')]
  }

  m = match(/^\/admin\/applications\/(\d+)\/lend$/)
  if (m && method === 'POST') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const a = state.applications.find((x) => x.id === m[0])
    if (!a) return [404, fail('NOT_FOUND', '申请不存在')]
    if (a.status !== 2) return [409, fail('STATE_CONFLICT', '仅待放款状态可放款')]
    const u = state.users.find((x) => x.id === a.user_id)
    if (!u) return [404, fail('NOT_FOUND', '用户不存在')]
    if (u.frozen) return [403, fail('FORBIDDEN', '借款人账号已冻结，不能放款')]
    if (state.blacklist.some((b) => b.user_id === u.id)) {
      return [403, fail('FORBIDDEN', '借款人在黑名单中，不能放款')]
    }
    const available = Number(u.credit_line) - Number(occupiedCredit(u.id))
    if (Number(a.amount) > available) return [409, fail('INSUFFICIENT_CREDIT', '可用授信不足，不能放款')]

    // 放款入账
    const lendNo = `LD${a.apply_no}`
    addFlow(u.id, a.amount, `放款 ${lendNo}`, lendNo, 'IN')
    // 生成还款计划
    const snap = a.rule_snapshot
    const schedule = buildSchedule(a.amount, snap.annual_rate, snap.term, snap.repay_type)
    const lendDate = today()
    schedule.forEach((row, i) => {
      state.plans.push({
        plan_id: String(state.seq.plan++),
        application_id: a.id,
        term_no: row.term_no,
        due_date: addMonthsClamped(lendDate, i + 1),
        principal: row.principal,
        interest: row.interest,
        penalty: '0.00',
        paid_principal: '0.00',
        paid_interest: '0.00',
        remaining_principal: row.principal,
        waived_interest: '0.00',
        status: 0,
        overdue_days: 0
      })
    })
    a.status = 3
    a.plans_generated = true
    a.updated_at = nowIso()
    addMessage(u.id, `LEND-${a.id}`, '放款成功', `申请 ${a.apply_no} 已放款 ${a.amount} 元，请按期还款。`)
    return [200, ok(appView(a), '放款成功，已生成还款计划')]
  }

  if (path === '/admin/blacklist' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const list = state.blacklist.map((b) => {
      const u = state.users.find((x) => x.id === b.user_id)
      return {
        user_id: b.user_id,
        username: u?.username || '',
        phone: u?.phone || '',
        reason: b.reason,
        created_at: b.created_at
      }
    })
    return [200, ok(paginate(list, query))]
  }

  m = match(/^\/admin\/blacklist\/(\d+)$/)
  if (m && method === 'PUT') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    if (!String(body.reason || '').trim()) return [422, fail('VALIDATION_ERROR', '拉黑原因必填')]
    const u = state.users.find((x) => x.id === m[0])
    if (!u) return [404, fail('NOT_FOUND', '用户不存在')]
    state.blacklist = state.blacklist.filter((b) => b.user_id !== u.id)
    state.blacklist.push({ user_id: u.id, reason: body.reason, created_at: nowIso() })
    addMessage(u.id, `BLACK-${u.id}`, '账号被列入黑名单', '您暂时不能发起新的借款申请，既有债务仍需偿还。')
    return [200, ok(adminUserView(u), '已加入黑名单')]
  }

  if (m && method === 'DELETE') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const before = state.blacklist.length
    state.blacklist = state.blacklist.filter((b) => b.user_id !== m[0])
    if (state.blacklist.length === before) return [404, fail('NOT_FOUND', '该用户不在黑名单')]
    return [200, ok(null, '已移出黑名单')]
  }

  if (path === '/admin/overdue' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const todayStr = today()
    const list = []
    for (const app of state.applications.filter((a) => a.status === 3)) {
      const u = state.users.find((x) => x.id === app.user_id)
      for (const p of state.plans.filter((x) => x.application_id === app.id)) {
        const overdueDays = Math.max(
          0,
          Math.floor((Date.parse(todayStr) - Date.parse(p.due_date)) / 86400000)
        )
        p.overdue_days = overdueDays
        p.status = p.status === 1 ? 1 : overdueDays > 0 ? 2 : 0
        if (overdueDays > 0) {
          list.push({
            user_id: app.user_id,
            username: u?.username || '',
            application_id: app.id,
            apply_no: app.apply_no,
            term_no: p.term_no,
            due_date: p.due_date,
            overdue_days: overdueDays,
            unpaid_principal: p.remaining_principal,
            unpaid_interest: p.interest,
            unpaid_penalty: p.penalty,
            plan_status: '逾期（申请仍为已放款）'
          })
        }
      }
    }
    return [200, ok(list)]
  }

  if (path === '/admin/statistics' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const lentApps = state.applications.filter((a) => a.status === 3 || a.status === 4)
    const lentTotal = lentApps.reduce((s, a) => s + Number(a.amount), 0)
    let outstanding = 0
    let overdueCount = 0
    const openApps = new Set()
    for (const p of state.plans) {
      if (p.status !== 1) {
        outstanding += Number(p.remaining_principal) + Number(p.interest) + Number(p.penalty)
        if (Number(p.overdue_days) > 0) openApps.add(p.application_id)
      }
    }
    const openLent = new Set(state.applications.filter((a) => a.status === 3).map((a) => a.id))
    overdueCount = openApps.size
    return [
      200,
      ok({
        lent_total: money(lentTotal),
        outstanding_total: money(outstanding),
        overdue_loans: overdueCount,
        open_lent_loans: openLent.size,
        overdue_rate: openLent.size ? ((overdueCount / openLent.size) * 100).toFixed(2) : '0.00',
        user_count: state.users.length,
        statistics_time: nowIso()
      })
    ]
  }

  if (path === '/risk/evaluate' && method === 'POST') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    const u = state.users.find((x) => x.id === String(body.user_id))
    if (!u) return [404, fail('NOT_FOUND', '用户不存在')]
    return [
      200,
      ok({
        decision: 'PASS',
        score: 60,
        level: 'C',
        credit_line: u.credit_line,
        is_mock: true,
        engine_version: 'mock-1.0'
      })
    ]
  }

  if (path === '/risk/datasources' && method === 'GET') {
    if (!currentAdmin(req)) return [403, fail('FORBIDDEN', '需要管理员身份')]
    return [200, ok([{ name: 'internal', type: 'internal', status: 'mock', is_mock: true }])]
  }

  // ---------------- A10 幂等结果查询 ----------------
  if (path === '/business-requests/result' && method === 'GET') {
    const u = currentUser(req)
    if (!u) return [401, fail('AUTH_REQUIRED', '未登录')]
    const key = query.get('key')
    const op = query.get('operation')
    const rec = state.idem.get(key)
    if (!rec || rec.subject !== u.id || (op && rec.operation !== op)) {
      return [200, ok({ found: false, note: '尚无成功记录' })]
    }
    return [200, ok({ found: true, result: rec.response })]
  }

  return [404, fail('NOT_FOUND', `Mock 未实现该接口：${method} ${path}`)]
}

function validateProduct(p) {
  if (!p.name) return '产品名称必填'
  if (![1, 2, 3].map(String).includes(String(p.repay_type))) return '还款方式须为 1/2/3'
  if (!(Number(p.annual_rate) >= 0)) return '年利率须为非负'
  if (!(Number(p.min_amount) > 0)) return '金额下限须为正'
  if (Number(p.min_amount) > Number(p.max_amount)) return '金额下限不能大于上限'
  if (!(Number(p.min_term) >= 1)) return '期数下限须≥1'
  if (Number(p.min_term) > Number(p.max_term)) return '期数下限不能大于上限'
  return null
}

// ------------------------------------------------------------------
// 服务启动
// ------------------------------------------------------------------
seed()

const server = http.createServer(async (req, res) => {
  // CORS（开发期允许 5173）
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Request-ID')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('X-Request-ID', randomUUID())
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  if (!url.pathname.startsWith(PREFIX)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify(fail('NOT_FOUND', '接口前缀应为 /api/v1')))
  }

  try {
    const result = await handle(req, res, url)
    if (result === null) return // 已自行响应（文件流）
    const [status, payload] = result
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  } catch (e) {
    console.error('[mock] 未捕获异常', e)
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(fail('INTERNAL_ERROR', 'Mock 内部错误')))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] FinLend Mock API 已启动: http://127.0.0.1:${PORT}${PREFIX}`)
  console.log('[mock] 演示账号 借款人 demo_user / demo1234，未实名用户 newbie / newbie1234')
  console.log('[mock] 管理员 admin / admin123，演示验证码固定 888888')
})
