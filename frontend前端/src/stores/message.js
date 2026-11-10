import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { messageApi } from '@/api'

/**
 * 站内消息未读数
 * 对应《需求分析报告》4.8：进消息页刷新列表；Web 端页面可见时轮询，隐藏时暂停。
 */
export const useMessageStore = defineStore('message', () => {
  const unread = ref(0)
  let timer = null

  async function refreshUnread() {
    try {
      const data = await messageApi.unreadCount()
      unread.value = Number(data?.unread ?? data?.count ?? 0)
    } catch {
      /* 轮询失败静默，不打扰用户 */
    }
  }

  /** 开始轮询（页面可见时 30 秒一次；不可见时暂停） */
  function startPolling(intervalMs = 30000) {
    stopPolling()
    refreshUnread()
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshUnread()
      }
    }, intervalMs)
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  const hasUnread = computed(() => unread.value > 0)

  function setUnread(n) {
    unread.value = Math.max(0, Number(n) || 0)
  }

  function decrementUnread() {
    unread.value = Math.max(0, unread.value - 1)
  }

  return { unread, hasUnread, refreshUnread, startPolling, stopPolling, setUnread, decrementUnread }
})
