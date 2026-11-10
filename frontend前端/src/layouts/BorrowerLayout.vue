<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useSessionStore } from '@/stores/session'
import { useMessageStore } from '@/stores/message'
import { fmtDateTime, maskPhone } from '@/utils/format'

const session = useSessionStore()
const messageStore = useMessageStore()
const route = useRoute()
const router = useRouter()

const activeMenu = computed(() => {
  if (route.path.startsWith('/products')) return '/products'
  if (route.path.startsWith('/applications')) return '/applications'
  if (route.path.startsWith('/account')) return '/account'
  if (route.path.startsWith('/messages')) return '/messages'
  if (route.path.startsWith('/profile')) return '/profile'
  return route.path
})

async function handleLogout() {
  await session.logout()
  ElMessage.success('已退出登录')
  router.replace('/login')
}

onMounted(() => {
  if (!session.profile) session.fetchProfile()
  messageStore.startPolling(30000)
})

onBeforeUnmount(() => {
  messageStore.stopPolling()
})
</script>

<template>
  <el-container class="borrower-shell">
    <el-header class="topbar">
      <div class="brand">
        <span class="logo">FinLend</span>
        <span class="tag">借款人端</span>
      </div>
      <div class="topbar-right">
        <el-badge :value="messageStore.unread" :hidden="!messageStore.hasUnread" :max="99">
          <el-button text @click="router.push('/messages')">消息</el-button>
        </el-badge>
        <el-divider direction="vertical" />
        <span class="who">
          {{ session.displayName }}
          <span class="muted">（{{ maskPhone(session.profile?.phone) }}）</span>
        </span>
        <el-tag v-if="session.isVerified" type="success" size="small" effect="plain">已模拟实名</el-tag>
        <el-tag v-else type="warning" size="small" effect="plain">未实名</el-tag>
        <el-button text @click="handleLogout">退出</el-button>
      </div>
    </el-header>

    <el-container>
      <el-aside width="200px" class="side">
        <el-menu :default-active="activeMenu" router>
          <el-menu-item index="/products">贷款产品</el-menu-item>
          <el-menu-item index="/applications">我的申请</el-menu-item>
          <el-menu-item index="/account">我的账户</el-menu-item>
          <el-menu-item index="/messages">站内消息</el-menu-item>
          <el-menu-item index="/profile">资料与实名</el-menu-item>
        </el-menu>
        <div class="side-foot muted">
          <div>课程演示平台</div>
          <div>所有身份与资金均为虚构</div>
          <div class="build">{{ fmtDateTime(new Date()) }}</div>
        </div>
      </el-aside>

      <el-main class="main">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.borrower-shell {
  min-height: 100vh;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid var(--finlend-border);
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
  color: var(--finlend-primary);
}
.tag {
  font-size: 12px;
  color: var(--finlend-muted);
  border: 1px solid var(--finlend-border);
  border-radius: 4px;
  padding: 1px 6px;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.who {
  font-size: 13px;
}
.side {
  background: #fff;
  border-right: 1px solid var(--finlend-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.side :deep(.el-menu) {
  border-right: none;
}
.side-foot {
  padding: 16px;
  font-size: 11px;
  line-height: 1.7;
}
.build {
  margin-top: 6px;
}
.main {
  padding: 24px;
}
</style>
