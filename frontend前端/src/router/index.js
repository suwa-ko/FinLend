import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { registerSessionExpiredHandler } from '@/utils/request'
import { getAccessToken, getClientScope } from '@/utils/storage'
import { resolveNavigation } from './guard'

// 守卫规则见 ./guard.js（纯函数，可独立测试）。重新导出便于外部引用。
export { resolveNavigation }

/**
 * 路由守卫用于交互引导；服务端权限检查仍是最终判断（对应《概要设计报告》5.2）。
 * 管理端与用户端使用独立路径前缀与独立登录入口。
 */
const routes = [
  { path: '/', redirect: '/products' },

  // ---------- 认证 ----------
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { public: true, layout: 'auth', scope: 'borrower', title: '登录' }
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { public: true, layout: 'auth', scope: 'borrower', title: '注册' }
  },
  {
    path: '/admin/login',
    name: 'adminLogin',
    component: () => import('@/views/auth/AdminLoginView.vue'),
    meta: { public: true, layout: 'auth', scope: 'admin', title: '管理端登录' }
  },

  // ---------- 借款人端 U01–U07 ----------
  {
    path: '/products',
    name: 'products',
    component: () => import('@/views/borrower/ProductQuoteView.vue'),
    meta: { title: '贷款产品', ui: 'U03', layout: 'borrower' }
  },
  {
    path: '/products/:id',
    name: 'productDetail',
    component: () => import('@/views/borrower/ProductQuoteView.vue'),
    meta: { title: '产品详情', ui: 'U03', layout: 'borrower' }
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/borrower/ProfileIdentityView.vue'),
    meta: { title: '资料与模拟实名', ui: 'U02', layout: 'borrower' }
  },
  {
    path: '/applications',
    name: 'applications',
    component: () => import('@/views/borrower/ApplicationListView.vue'),
    meta: { title: '我的借款申请', ui: 'U04', layout: 'borrower' }
  },
  {
    path: '/applications/:id',
    name: 'applicationDetail',
    component: () => import('@/views/borrower/ApplicationDetailView.vue'),
    meta: { title: '申请详情', ui: 'U04', layout: 'borrower' }
  },
  {
    path: '/repayment/:id',
    name: 'repayment',
    component: () => import('@/views/borrower/RepaymentView.vue'),
    meta: { title: '还款与结清', ui: 'U05', layout: 'borrower' }
  },
  {
    path: '/account',
    name: 'account',
    component: () => import('@/views/borrower/AccountOverviewView.vue'),
    meta: { title: '我的账户', ui: 'U06', layout: 'borrower' }
  },
  {
    path: '/messages',
    name: 'messages',
    component: () => import('@/views/borrower/MessageCenterView.vue'),
    meta: { title: '站内消息', ui: 'U07', layout: 'borrower' }
  },

  // ---------- 管理端 U09–U12 ----------
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { layout: 'admin', admin: true },
    children: [
      { path: '', redirect: '/admin/users' },
      {
        path: 'users',
        name: 'adminUsers',
        component: () => import('@/views/admin/AdminUserRiskView.vue'),
        meta: { title: '用户与黑名单', ui: 'U09', admin: true }
      },
      {
        path: 'products',
        name: 'adminProducts',
        component: () => import('@/views/admin/AdminProductView.vue'),
        meta: { title: '产品管理', ui: 'U10', admin: true }
      },
      {
        path: 'audit',
        name: 'adminAudit',
        component: () => import('@/views/admin/AdminAuditLendView.vue'),
        meta: { title: '审批与放款', ui: 'U11', admin: true }
      },
      {
        path: 'overdue',
        name: 'adminOverdue',
        component: () => import('@/views/admin/AdminOverdueReportView.vue'),
        meta: { title: '逾期与统计', ui: 'U12', admin: true }
      }
    ]
  },

  { path: '/:pathMatch(.*)*', redirect: '/products' }
]

/** 创建路由时绑定守卫 */
export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior: () => ({ top: 0 })
  })

  router.beforeEach((to) => {
    return resolveNavigation(to, {
      loggedIn: Boolean(getAccessToken()),
      currentScope: getClientScope()
    })
  })

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · FinLend` : 'FinLend 借贷软件平台'
  })

  // 会话失效统一回到对应登录页
  registerSessionExpiredHandler(() => {
    const current = router.currentRoute.value
    const isAdminArea = current.path.startsWith('/admin')
    router.replace({
      path: isAdminArea ? '/admin/login' : '/login',
      query: { redirect: current.fullPath, expired: '1' }
    })
  })

  return router
}

export default createAppRouter
