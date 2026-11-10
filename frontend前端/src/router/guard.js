/**
 * 路由守卫判定规则（纯函数，无框架依赖，可独立测试）
 *
 * 历史缺陷（已修复）：
 *   1. 已登录访问 /admin/login 且会话类型不匹配时返回 undefined → 静默取消导航，页面无反应
 *   2. /admin/login 命中「path 以 /admin 开头」规则又被重定向回自身 → 自环
 *
 * 规则：
 *   - 登录页永远可进入（用于切换身份）
 *   - 未登录访问业务页 → 跳对应登录页
 *   - 已登录访问与自身匹配的登录页 → 回对应首页
 *   - 借款人会话进入管理端业务页 → 跳管理端登录
 *   - 管理端会话进入借款人业务页 → 回管理端首页
 *
 * @param {{ path: string, fullPath?: string, meta: object }} to 目标路由
 * @param {{ loggedIn: boolean, currentScope: string }} ctx 当前会话上下文
 * @returns {true | { path: string, query?: object }} true 放行；对象则重定向
 */
export function resolveNavigation(to, ctx) {
  const { loggedIn, currentScope } = ctx
  const isAuthPage = to.meta?.public === true
  const fullPath = to.fullPath || to.path

  // ---------- 情况 0：目标就是登录页 —— 优先放行 ----------
  // 必须先于「未登录」判断，否则未登录访问 /admin/login 会被重定向到自身形成自环。
  if (isAuthPage) {
    if (!loggedIn) return true
    // 已登录：与当前会话类型匹配的登录页 → 回对应首页
    if (to.meta.scope === 'admin' && currentScope === 'admin') return { path: '/admin/users' }
    if (to.meta.scope !== 'admin' && currentScope !== 'admin') return { path: '/products' }
    // 会话类型与登录页不匹配（如借款人已登录却点管理端入口）：放行以切换身份
    return true
  }

  // ---------- 情况 1：未登录访问业务页 ----------
  if (!loggedIn) {
    return to.path.startsWith('/admin')
      ? { path: '/admin/login', query: { redirect: fullPath } }
      : { path: '/login', query: { redirect: fullPath } }
  }

  // ---------- 情况 2：已登录进入管理端业务页 ----------
  if (to.path.startsWith('/admin') && currentScope !== 'admin') {
    return { path: '/admin/login', query: { redirect: fullPath } }
  }

  // ---------- 情况 3：管理端会话进入借款人业务页 ----------
  if (!to.path.startsWith('/admin') && currentScope === 'admin') {
    return { path: '/admin/users' }
  }

  return true
}
