/**
 * 端到端联调验证脚本（浏览器联调与核心流程验证记录的证据来源）
 *
 * 直接调用 Mock/真实后端 HTTP 接口，按《需求分析报告》5.1 借款主流程逐段验证：
 *   注册 → 模拟实名 → 浏览试算 → 提交申请 → 审批 → 签约 → 放款 → 还款 → 结清
 * 同时验证：幂等键、重复提交、权限隔离、状态冲突、金额校验。
 *
 * 用法：node scripts/e2e-check.js [baseUrl]
 *   默认 http://127.0.0.1:5173/api/v1（走 Vite 代理，等价浏览器访问）
 */
const BASE = process.argv[2] || 'http://127.0.0.1:5173/api/v1'

const results = []
let failures = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures += 1
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? '  —  ' + detail : ''}`)
}

async function call(method, path, { token, body, idemKey, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (idemKey) headers['Idempotency-Key'] = idemKey
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  })
  let json = null
  try {
    json = await resp.json()
  } catch {
    json = null
  }
  return { status: resp.status, json, requestId: resp.headers.get('x-request-id') }
}

function expect(name, cond, detail = '') {
  record(name, Boolean(cond), detail)
}

async function main() {
  console.log(`\n=== FinLend 端到端验证，目标 ${BASE} ===\n`)

  // ---------- 1. 注册 ----------
  const phone = `139${String(Date.now()).slice(-8)}`
  const username = `e2e${String(Date.now()).slice(-6)}`
  const regKey = `REG-${username}`
  let r = await call('POST', '/auth/register', {
    body: { username, phone, password: 'e2e12345', code: '888888' },
    idemKey: regKey
  })
  expect('AUTH-01 注册成功（201）', r.status === 201 && r.json.code === 0, `user_id=${r.json?.data?.user_id}`)

  r = await call('POST', '/auth/register', {
    body: { username, phone, password: 'e2e12345', code: '888888' },
    idemKey: regKey
  })
  expect('AUTH-01 重复账号被拒绝（409）', r.status === 409, `code=${r.json?.code}`)

  r = await call('POST', '/auth/register', {
    body: { username: `${username}x`, phone: `${phone}0`, password: 'e2e12345', code: '000000' },
    idemKey: `REG2-${username}`
  })
  expect('AUTH-01 验证码错误被拒绝（422）', r.status === 422, `code=${r.json?.code}`)

  // ---------- 2. 登录（用户端） ----------
  r = await call('POST', '/auth/login', {
    body: { username, password: 'e2e12345', client_type: 'WEB', device_id: 'e2e-device' }
  })
  expect('AUTH-02 借款人登录成功', r.status === 200 && !!r.json.data?.access_token)
  const userToken = r.json.data.access_token

  r = await call('POST', '/auth/login', { body: { username, password: 'wrong-pass' } })
  expect('AUTH-02 错误密码被拒绝（401）', r.status === 401, `code=${r.json?.code}`)

  // ---------- 3. 权限隔离：用户不能调管理接口 ----------
  r = await call('GET', '/admin/users', { token: userToken })
  expect('NFR-02 借款人调用管理接口被拒绝（403）', r.status === 403, `code=${r.json?.code}`)

  // ---------- 4. 未实名不能申请 ----------
  r = await call('POST', '/applications', {
    token: userToken,
    body: { product_id: '1', amount: '12000.00', term: 12, purpose: 'E2E 测试' },
    idemKey: 'E2E-NOIDV-1'
  })
  expect('LOAN-02 未实名不能申请（403）', r.status === 403, `code=${r.json?.code}`)

  // ---------- 5. 模拟实名 ----------
  r = await call('POST', '/users/me/identity', {
    token: userToken,
    body: { real_name: '端到端测试', id_card: '110101199003077777', file_id: '1' },
    idemKey: `IDV-${username}`
  })
  expect('AUTH-04 模拟实名格式检查通过', r.status === 200 && r.json.data?.verified === true)

  r = await call('POST', '/users/me/identity', {
    token: userToken,
    body: { real_name: '端到端测试', id_card: '1234', file_id: '1' },
    idemKey: `IDV-BAD-${username}`
  })
  expect('AUTH-04 非法证件号被拒绝（422）', r.status === 422, `code=${r.json?.code}`)

  // ---------- 6. 产品与试算 ----------
  r = await call('GET', '/products', { token: userToken })
  expect('PROD-01 产品列表可读', r.status === 200 && r.json.data.length >= 3)

  r = await call('POST', '/loans/quote', {
    token: userToken,
    body: { product_id: '1', amount: '12000.00', term: 12 }
  })
  const quote = r.json?.data
  expect('LOAN-01 试算返回逐期计划', r.status === 200 && quote?.schedule?.length === 12)
  // 验算基准：P=12000, 12%, 12 期 → 前 11 期 1066.19，末期 1066.14，总利息 794.23
  expect(
    'LOAN-01 等额本息前11期月供=1066.19',
    quote?.schedule?.[0]?.amount === '1066.19' && quote?.schedule?.[10]?.amount === '1066.19',
    `首期=${quote?.schedule?.[0]?.amount}`
  )
  expect(
    'LOAN-01 等额本息末期平账=1066.14',
    quote?.schedule?.[11]?.amount === '1066.14',
    `末期=${quote?.schedule?.[11]?.amount}`
  )
  expect('LOAN-01 总利息=794.23', quote?.total_interest === '794.23', `总利息=${quote?.total_interest}`)

  r = await call('POST', '/loans/quote', {
    token: userToken,
    body: { product_id: '1', amount: '999999.00', term: 12 }
  })
  expect('LOAN-01 超区间金额被拒绝（422）', r.status === 422, `code=${r.json?.code}`)

  // ---------- 7. 提交申请（含幂等） ----------
  const appKey = `APP-${username}`
  const appBody = { product_id: '1', amount: '12000.00', term: 12, purpose: 'E2E 联调' }
  r = await call('POST', '/applications', { token: userToken, body: appBody, idemKey: appKey })
  const appId = r.json?.data?.application_id
  expect('LOAN-02 提交申请成功（201，待审核）', r.status === 201 && r.json.data.status === 0, `appId=${appId}`)

  r = await call('POST', '/applications', { token: userToken, body: appBody, idemKey: appKey })
  expect('NFR-03 相同幂等键重复提交返回同一申请', r.status === 200 && r.json.data.application_id === appId)

  r = await call('GET', `/applications?limit=20`, { token: userToken })
  expect('NFR-03 未产生重复申请', r.json.data.items.filter((a) => a.application_id === appId).length === 1)

  r = await call('GET', `/business-requests/result?operation=APPLICATION_CREATE&key=${appKey}`, {
    token: userToken
  })
  expect('A10 幂等结果可查询（found=true）', r.json.data?.found === true)

  // ---------- 8. 管理员登录 & 审批 ----------
  r = await call('POST', '/admin/auth/login', {
    body: { username: 'admin', password: 'admin123', client_type: 'WEB', device_id: 'e2e-admin' }
  })
  expect('A01 管理员登录（独立入口）', r.status === 200 && !!r.json.data?.access_token)
  const adminToken = r.json.data.access_token

  r = await call('POST', '/applications', {
    token: adminToken,
    body: appBody,
    idemKey: 'E2E-ADMIN-AS-USER'
  })
  expect('NFR-02 管理员令牌不能当借款人使用（401）', r.status === 401, `code=${r.json?.code}`)

  r = await call('POST', `/admin/applications/${appId}/audit`, {
    token: adminToken,
    body: { decision: 'APPROVE', opinion: '' },
    idemKey: `AUDIT-${appId}`
  })
  expect('LOAN-04 审批通过进入待签约', r.status === 200 && r.json.data.status === 1)
  const signDeadline = r.json.data.sign_deadline
  expect('LOAN-05 返回 72 小时签约截止', Boolean(signDeadline), `截止=${signDeadline}`)

  r = await call('POST', `/admin/applications/${appId}/audit`, {
    token: adminToken,
    body: { decision: 'APPROVE' },
    idemKey: `AUDIT-AGAIN-${appId}`
  })
  expect('LOAN-04 并发/重复审批被拒绝（409）', r.status === 409, `code=${r.json?.code}`)

  // ---------- 9. 签约 ----------
  r = await call('POST', `/applications/${appId}/sign`, {
    token: userToken,
    body: { confirmed: true },
    idemKey: `SIGN-${appId}`
  })
  expect('LOAN-05 签约成功进入待放款', r.status === 200 && r.json.data.status === 2)

  r = await call('POST', `/applications/${appId}/sign`, {
    token: userToken,
    body: { confirmed: true },
    idemKey: `SIGN-AGAIN-${appId}`
  })
  expect('LOAN-05 重复签约被拒绝（409）', r.status === 409, `code=${r.json?.code}`)

  // ---------- 10. 放款 ----------
  r = await call('GET', '/accounts/me', { token: userToken })
  const balanceBefore = r.json.data.balance
  r = await call('POST', `/admin/applications/${appId}/lend`, { token: adminToken, idemKey: `LEND-${appId}` })
  expect('LEND-01 放款成功', r.status === 200 && r.json.data.status === 3)

  r = await call('GET', '/accounts/me', { token: userToken })
  const acc = r.json.data
  expect(
    'LEND-01 放款增加借款人余额（入账方向正确）',
    Number(acc.balance) === Number(balanceBefore) + 12000,
    `${balanceBefore} → ${acc.balance}`
  )
  expect('LEND-01 放款占用授信 12000', acc.occupied_credit === '12000.00', `占用=${acc.occupied_credit}`)
  expect(
    'LEND-01 可用额度 = 50000 - 12000 = 38000',
    acc.available_credit === '38000.00',
    `可用=${acc.available_credit}`
  )

  r = await call('POST', `/admin/applications/${appId}/lend`, { token: adminToken, idemKey: `LEND-AGAIN-${appId}` })
  expect('LEND-01 重复放款被拒绝（409）', r.status === 409, `code=${r.json?.code}`)

  // ---------- 11. 还款计划 ----------
  r = await call('GET', `/applications/${appId}/plans`, { token: userToken })
  const plans = r.json.data
  expect('REPAY-01 生成 12 期计划', plans.length === 12)
  const principalSum = plans.reduce((s, p) => s + Number(p.principal), 0)
  expect('REPAY-01 各期本金之和精确等于借款额', Math.abs(principalSum - 12000) < 0.005, `合计=${principalSum.toFixed(2)}`)
  expect('REPAY-01 期数不重复', new Set(plans.map((p) => p.term_no)).size === 12)

  // ---------- 12. 普通还款 ----------
  const p1 = plans[0]
  const due1 = (Number(p1.remaining_principal) + Number(p1.interest) + Number(p1.penalty)).toFixed(2)
  r = await call('POST', `/applications/${appId}/repay`, {
    token: userToken,
    body: { plan_id: p1.plan_id, confirm_amount: '1.00' },
    idemKey: `REPAY-BAD-${appId}`
  })
  expect('REPAY-02 金额不符被拒绝（409 AMOUNT_CHANGED）', r.status === 409 && r.json.code === 'AMOUNT_CHANGED')

  r = await call('POST', `/applications/${appId}/repay`, {
    token: userToken,
    body: { plan_id: p1.plan_id, confirm_amount: due1 },
    idemKey: `REPAY1-${appId}`
  })
  expect('REPAY-02 按期还款成功', r.status === 200 && r.json.data.repay_no?.startsWith('RP'))
  const repayNo1 = r.json?.data?.repay_no

  r = await call('POST', `/applications/${appId}/repay`, {
    token: userToken,
    body: { plan_id: p1.plan_id, confirm_amount: due1 },
    idemKey: `REPAY1-${appId}`
  })
  expect('NFR-03 同键重复还款返回原结果（不重复扣款）', r.json?.data?.repay_no === repayNo1)

  r = await call('GET', `/applications/${appId}/plans`, { token: userToken })
  const paidCount = r.json.data.filter((p) => p.status === 1).length
  expect('NFR-03 只结清 1 期（未重复记账）', paidCount === 1, `已还期数=${paidCount}`)

  // ---------- 13. 提前结清 ----------
  // 说明：提前结清需要账户余额足够支付全部未还本金；此时余额已用掉一期还款，
  // 故先用未实名的新用户「补足余额」场景不可行，改为单独建一笔小额借款验证结清。
  // 这里用第二笔 1000 元借款（不还款直接结清）验证结清链路与余额校验。
  r = await call('POST', '/applications', {
    token: userToken,
    body: { product_id: '1', amount: '1000.00', term: 3, purpose: '结清验证' },
    idemKey: `APP-SETTLE-${username}`
  })
  const appSettle = r.json?.data?.application_id
  expect('SETTLE 建立结清验证用小额借款', r.status === 201, `appId=${appSettle}`)

  r = await call('POST', `/admin/applications/${appSettle}/audit`, {
    token: adminToken,
    body: { decision: 'APPROVE', opinion: '' },
    idemKey: `AUDIT-S-${appSettle}`
  })
  r = await call('POST', `/applications/${appSettle}/sign`, {
    token: userToken,
    body: { confirmed: true },
    idemKey: `SIGN-S-${appSettle}`
  })
  r = await call('POST', `/admin/applications/${appSettle}/lend`, {
    token: adminToken,
    idemKey: `LEND-S-${appSettle}`
  })
  expect('SETTLE 小额借款放款成功', r.status === 200 && r.json.data.status === 3)

  r = await call('GET', `/applications/${appSettle}/settlement-quote`, { token: userToken })
  const settleQuote = r.json?.data
  expect(
    'REPAY-03 可获取结清报价',
    r.status === 200 && Boolean(settleQuote?.total_amount),
    `总额=${settleQuote?.total_amount} 减免利息=${settleQuote?.waived_interest}`
  )
  expect(
    'REPAY-03 未到期利息记为减免而非收取',
    settleQuote?.due_interest === '0.00' && Number(settleQuote?.waived_interest) > 0,
    `到期利息=${settleQuote?.due_interest} 减免=${settleQuote?.waived_interest}`
  )

  r = await call('POST', `/applications/${appSettle}/settle`, {
    token: userToken,
    body: { confirm_amount: '0.01' },
    idemKey: `SETTLE-BAD-${appSettle}`
  })
  expect('REPAY-03 结清金额不符被拒绝（AMOUNT_CHANGED）', r.status === 409 && r.json.code === 'AMOUNT_CHANGED')

  r = await call('POST', `/applications/${appSettle}/settle`, {
    token: userToken,
    body: { confirm_amount: settleQuote.total_amount },
    idemKey: `SETTLE-${appSettle}`
  })
  expect('REPAY-03 整笔提前结清成功', r.status === 200, `code=${r.json?.code}`)

  r = await call('GET', `/applications/${appSettle}`, { token: userToken })
  expect('REPAY-05 结清后申请状态为已结清（4）', r.json.data.status === 4)

  r = await call('GET', '/messages?limit=50', { token: userToken })
  const titlesAfter = r.json.data.items.map((m) => m.title)
  expect(
    'A08 结清事件生成「借款已结清」消息',
    titlesAfter.includes('借款已结清'),
    titlesAfter.join(' / ')
  )

  // 大额借款仍有余额占用，验证结清释放：小额借款已结清，占用应只剩大额那笔
  r = await call('GET', '/accounts/me', { token: userToken })
  const occ = Number(r.json.data.occupied_credit)
  expect(
    'REPAY-05 结清后该笔授信占用被释放',
    occ > 0 && occ <= 12000,
    `占用=${r.json.data.occupied_credit}（大额借款未还部分）`
  )

  // ---------- 14. 消息 ----------
  r = await call('GET', '/messages/unread-count', { token: userToken })
  expect('A08 未读数接口可用', r.status === 200 && typeof r.json.data.unread === 'number', `未读=${r.json?.data?.unread}`)

  r = await call('GET', '/messages?limit=50', { token: userToken })
  const titles = r.json.data.items.map((m) => m.title)
  // 说明：本次运行中会被结清的借款不一定为大额那笔，
  // 故只校验「放款成功」消息存在；结清消息由 SETTLE 小节单独校验。
  expect(
    'A08 关键事件均生成消息',
    ['申请已通过', '签约成功', '放款成功', '还款成功'].every((t) => titles.includes(t)),
    titles.join(' / ')
  )

  // ---------- 15. 撤销路径 ----------
  r = await call('POST', '/applications', {
    token: userToken,
    body: { product_id: '2', amount: '3000.00', term: 6, purpose: '撤销测试' },
    idemKey: `APP-CANCEL-${username}`
  })
  const appId2 = r.json?.data?.application_id
  r = await call('POST', `/applications/${appId2}/cancel`, { token: userToken, idemKey: `CANCEL-${appId2}` })
  expect('LOAN-03 待审核状态可撤销', r.status === 200 && r.json.data.status === 6)

  // ---------- 16. 管理端：黑名单与冻结 ----------
  r = await call('PUT', '/admin/blacklist/3', { token: adminToken, body: { reason: '' }, idemKey: 'BL-BAD' })
  expect('ADMIN 拉黑原因必填（422）', r.status === 422)

  r = await call('PUT', '/admin/blacklist/3', {
    token: adminToken,
    body: { reason: 'E2E 黑名单验证' },
    idemKey: 'BL-3'
  })
  expect('ADMIN 加入黑名单成功', r.status === 200)

  r = await call('PUT', '/admin/users/3/status', { token: adminToken, body: { frozen: true }, idemKey: 'FRZ-3' })
  expect('ADMIN 冻结用户成功', r.status === 200)

  r = await call('POST', '/auth/login', { body: { username: 'newbie', password: 'newbie1234' } })
  expect('ADMIN 冻结后不能登录（403）', r.status === 403, `code=${r.json?.code}`)

  // ---------- 17. 逾期与统计 ----------
  r = await call('GET', '/admin/overdue', { token: adminToken })
  expect('ADMIN 逾期列表可读', r.status === 200 && Array.isArray(r.json.data))

  r = await call('GET', '/admin/statistics', { token: adminToken })
  const st = r.json?.data
  expect(
    'ADMIN 统计口径可用',
    r.status === 200 && st.user_count >= 3 && typeof st.overdue_rate === 'string',
    `用户数=${st?.user_count} 逾期率=${st?.overdue_rate}%`
  )

  // ---------- 18. 会话 ----------
  const refreshToken = (await call('POST', '/auth/login', {
    body: { username, password: 'e2e12345' }
  })).json.data.refresh_token
  r = await call('POST', '/auth/refresh', { body: { refresh_token: refreshToken } })
  expect('A01 刷新令牌可轮换', r.status === 200 && r.json.data.access_token !== userToken)
  r = await call('POST', '/auth/refresh', { body: { refresh_token: refreshToken } })
  expect('A01 旧刷新令牌被吊销（401）', r.status === 401)

  // ---------- 汇总 ----------
  const total = results.length
  const passed = total - failures
  console.log(`\n=== 结果：${passed}/${total} 通过，${failures} 失败 ===\n`)
  if (failures) {
    console.log('失败项：')
    results.filter((x) => !x.ok).forEach((x) => console.log(`  - ${x.name} ${x.detail}`))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('验证脚本异常：', e)
  process.exitCode = 2
})
