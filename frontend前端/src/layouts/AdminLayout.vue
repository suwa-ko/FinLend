<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const activeMenu = computed(() => {
  if (route.path.startsWith('/admin/users')) return '/admin/users'
  if (route.path.startsWith('/admin/products')) return '/admin/products'
  if (route.path.startsWith('/admin/audit')) return '/admin/audit'
  if (route.path.startsWith('/admin/overdue')) return '/admin/overdue'
  return route.path
})

async function handleLogout() {
  await session.logout()
  ElMessage.success('已退出管理端')
  router.replace('/admin/login')
}
</script>

<template>
  <el-container class="admin-shell">
    <el-header class="topbar">
      <div class="brand">
        <span class="logo">FinLend</span>
        <span class="tag">管理端</span>
        <span class="mock-badge">仅课程演示</span>
      </div>
      <div class="topbar-right">
        <span class="who">{{ session.displayName }}</span>
        <el-button text @click="handleLogout">退出</el-button>
      </div>
    </el-header>
    <el-container>
      <el-aside width="200px" class="side">
        <el-menu :default-active="activeMenu" router>
          <el-menu-item index="/admin/users">用户与黑名单</el-menu-item>
          <el-menu-item index="/admin/products">产品管理</el-menu-item>
          <el-menu-item index="/admin/audit">审批与放款</el-menu-item>
          <el-menu-item index="/admin/overdue">逾期与统计</el-menu-item>
        </el-menu>
      </el-aside>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1f2328;
  height: 56px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}
.tag {
  font-size: 12px;
  color: #c9d1d9;
  border: 1px solid #444c56;
  border-radius: 4px;
  padding: 1px 6px;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #c9d1d9;
  font-size: 13px;
}
.side {
  background: #fff;
  border-right: 1px solid var(--finlend-border);
}
.side :deep(.el-menu) {
  border-right: none;
}
.main {
  padding: 24px;
}
</style>
