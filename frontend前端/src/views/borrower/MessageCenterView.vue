<script setup>
import { onMounted, reactive, ref } from 'vue'
import { messageApi } from '@/api'
import { useMessageStore } from '@/stores/message'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import { fmtDateTime } from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'
import EmptyState from '@/components/EmptyState.vue'

const messageStore = useMessageStore()

const list = ref([])
const total = ref(0)
const page = reactive({ offset: 0, limit: 20 })
const loading = ref(false)
const loadError = ref('')

const unreadOnly = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await messageApi.list({ offset: page.offset, limit: page.limit })
    list.value = data.items
    total.value = data.total
    await messageStore.refreshUnread()
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '消息加载失败'
  } finally {
    loading.value = false
  }
}

async function markRead(row) {
  if (row.is_read) return
  const scope = `MSG_READ_${row.id}`
  try {
    const res = await messageApi.markRead(row.id, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    row.is_read = true
    if (res && typeof res.unread === 'number') messageStore.setUnread(res.unread)
    else messageStore.decrementUnread()
  } catch (e) {
    if (e instanceof ApiError) loadError.value = e.message
  }
}

async function markAllRead() {
  const unreadItems = list.value.filter((m) => !m.is_read)
  for (const m of unreadItems) {
    // 逐条提交，避免一次失败影响全部
    // eslint-disable-next-line no-await-in-loop
    await markRead(m)
  }
}

function onPageChange(p) {
  page.offset = (p - 1) * page.limit
  load()
}

onMounted(load)
</script>

<template>
  <div>
    <h2 class="page-title">站内消息</h2>
    <p class="page-desc">
      审批结果、放款成功、还款提醒与逾期提醒在此展示；同一事件只生成一条消息。进入本页会刷新列表并更新未读数。
    </p>

    <div class="toolbar">
      <el-button @click="load">刷新列表</el-button>
      <el-button type="primary" plain @click="markAllRead">本页全部标为已读</el-button>
      <div class="spacer" />
      <span class="muted">未读 {{ messageStore.unread }} 条</span>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />

    <template v-else>
      <el-table v-loading="loading" :data="list" size="small" border :row-class-name="({ row }) => (row.is_read ? '' : 'unread-row')">
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="!row.is_read" type="danger" size="small" effect="dark">未读</el-tag>
            <span v-else class="muted">已读</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" width="180" />
        <el-table-column prop="content" label="内容" min-width="260" />
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button v-if="!row.is_read" text type="primary" size="small" @click="markRead(row)">
              标为已读
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState description="暂无消息" />
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :total="total"
          :page-size="page.limit"
          :current-page="page.offset / page.limit + 1"
          @current-change="onPageChange"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
:deep(.unread-row) {
  background: #fffbe6;
}
</style>
