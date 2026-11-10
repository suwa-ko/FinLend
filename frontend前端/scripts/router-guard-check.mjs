/**
 * 路由守卫行为验证 —— 直接导入 src/router/index.js 的 resolveNavigation
 *
 * 回归目标：修复「管理员入口点不进去」。
 * 旧实现的两个缺陷：
 *   1. 已登录访问 /admin/login 且会话类型不匹配时返回 undefined → 静默取消导航，页面无反应
 *   2. /admin/login 命中「path 以 /admin 开头」规则又被重定向回自身 → 自环
 *
 * 用法：node scripts/router-guard-check.mjs
 */
import { resolveNavigation } from '../src/router/guard.js'

const P = (path, meta = {}) => ({ path, fullPath: path, meta })

const cases = [
  {
    name: '① 借款人已登录，点击管理员入口（旧代码：导航被取消）',
    to: P('/admin/login', { public: true, scope: 'admin' }),
    ctx: { loggedIn: true, currentScope: 'borrower' },
    expect: true
  },
  {
    name: '② 管理员登录后进入管理端首页',
    to: P('/admin/users', { admin: true }),
    ctx: { loggedIn: true, currentScope: 'admin' },
    expect: true
  },
  {
    name: '③ 未登录访问管理端业务页 → 跳管理端登录',
    to: P('/admin/users', { admin: true }),
    ctx: { loggedIn: false, currentScope: '' },
    expect: { path: '/admin/login', query: { redirect: '/admin/users' } }
  },
  {
    name: '④ 未登录访问借款人页 → 跳借款人登录',
    to: P('/products', {}),
    ctx: { loggedIn: false, currentScope: '' },
    expect: { path: '/login', query: { redirect: '/products' } }
  },
  {
    name: '⑤ 管理端会话访问借款人页 → 回管理端',
    to: P('/products', {}),
    ctx: { loggedIn: true, currentScope: 'admin' },
    expect: { path: '/admin/users' }
  },
  {
    name: '⑥ 借款人会话访问管理端业务页 → 跳管理端登录',
    to: P('/admin/audit', { admin: true }),
    ctx: { loggedIn: true, currentScope: 'borrower' },
    expect: { path: '/admin/login', query: { redirect: '/admin/audit' } }
  },
  {
    name: '⑦ 借款人已登录再访问借款人登录页 → 回产品页',
    to: P('/login', { public: true, scope: 'borrower' }),
    ctx: { loggedIn: true, currentScope: 'borrower' },
    expect: { path: '/products' }
  },
  {
    name: '⑧ 管理员已登录访问管理端登录页 → 回管理首页',
    to: P('/admin/login', { public: true, scope: 'admin' }),
    ctx: { loggedIn: true, currentScope: 'admin' },
    expect: { path: '/admin/users' }
  },
  {
    name: '⑨ 管理员已登录访问借款人登录页（切换身份）→ 放行',
    to: P('/login', { public: true, scope: 'borrower' }),
    ctx: { loggedIn: true, currentScope: 'admin' },
    expect: true
  },
  {
    name: '⑩ 未登录访问管理端登录页 → 放行',
    to: P('/admin/login', { public: true, scope: 'admin' }),
    ctx: { loggedIn: false, currentScope: '' },
    expect: true
  },
  {
    name: '⑪ 未登录访问用户端登录页 → 放行',
    to: P('/login', { public: true, scope: 'borrower' }),
    ctx: { loggedIn: false, currentScope: '' },
    expect: true
  }
]

const META = {
  '/login': { public: true, scope: 'borrower' },
  '/register': { public: true, scope: 'borrower' },
  '/admin/login': { public: true, scope: 'admin' },
  '/admin/users': { admin: true },
  '/admin/audit': { admin: true },
  '/admin/products': { admin: true },
  '/admin/overdue': { admin: true },
  '/products': {},
  '/applications': {},
  '/account': {},
  '/messages': {},
  '/profile': {}
}

let fail = 0
console.log('\n=== 路由守卫行为验证（管理员入口修复）===\n')
for (const c of cases) {
  const got = resolveNavigation(c.to, c.ctx)
  const ok = JSON.stringify(got) === JSON.stringify(c.expect)
  if (!ok) fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (!ok) console.log(`      期望 ${JSON.stringify(c.expect)}\n      实际 ${JSON.stringify(got)}`)
}

// 穷举：任何路径 × 任何会话类型下，守卫都不返回 undefined（旧代码的核心缺陷）
let undef = 0
let selfLoop = 0
let checked = 0
for (const path of Object.keys(META)) {
  for (const scope of ['', 'borrower', 'admin']) {
    for (const loggedIn of [true, false]) {
      checked += 1
      const r = resolveNavigation(P(path, META[path]), { loggedIn, currentScope: scope })
      if (r === undefined) undef += 1
      if (r && r.path === path) selfLoop += 1 // 重定向到自身 = 死循环
    }
  }
}
console.log(`\n${undef === 0 ? 'PASS' : 'FAIL'}  ⑫ 穷举 ${checked} 种组合，守卫从不返回 undefined`)
if (undef) fail += 1
console.log(`${selfLoop === 0 ? 'PASS' : 'FAIL'}  ⑬ 穷举 ${checked} 种组合，不存在「重定向到自身」的自环`)
if (selfLoop) fail += 1

const total = cases.length + 2
console.log(`\n=== 结果：${total - fail}/${total} 通过 ===\n`)
process.exitCode = fail ? 1 : 0
