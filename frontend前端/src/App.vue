<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import BorrowerLayout from '@/layouts/BorrowerLayout.vue'
import AdminLayout from '@/layouts/AdminLayout.vue'

const route = useRoute()

/**
 * 布局选择：管理端使用 AdminLayout，认证页无侧栏，其余走借款人端布局。
 */
const layout = computed(() => {
  if (route.meta.layout === 'admin' || route.path.startsWith('/admin')) return 'admin'
  if (route.meta.layout === 'auth') return 'auth'
  if (route.meta.layout === 'borrower') return 'borrower'
  return 'auth'
})
</script>

<template>
  <router-view v-if="layout === 'auth'" v-slot="{ Component }">
    <transition name="fade" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
  <BorrowerLayout v-else-if="layout === 'borrower'">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </BorrowerLayout>
  <AdminLayout v-else />
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
