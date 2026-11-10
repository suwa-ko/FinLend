<script setup>
import { onMounted, ref } from 'vue'
import { adminApi } from '@/api'
import { ApiError } from '@/utils/request'
import { fmtDate, fmtDateTime, fmtMoney } from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'

const overdue = ref([])
const stats = ref(null)
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [list, stat] = await Promise.all([adminApi.overdue(), adminApi.statistics()])
    overdue.value = list
    stats.value = stat
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '逾期数据加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <h2 class="page-title">逾期与统计</h2>
    <p class="page-desc">
      逾期是还款计划状态，不是申请状态：申请仍显示「已放款」，对应期次单独标记逾期。统计为 P1 可选增强，数据口径见需求文档 4.7。
    </p>

    <div class="toolbar">
      <el-button text @click="load">刷新</el-button>
      <div class="spacer" />
      <span v-if="stats" class="muted">统计时间 {{ fmtDateTime(stats.statistics_time) }}</span>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />

    <div v-else v-loading="loading">
      <div class="stat-row" v-if="stats">
        <div class="stat-card">
          <div class="stat-label">放款总额</div>
          <div class="stat-value money">{{ fmtMoney(stats.lent_total) }}</div>
          <div class="stat-hint">已放款或已结清的申请金额合计</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">待还总额</div>
          <div class="stat-value money">{{ fmtMoney(stats.outstanding_total) }}</div>
          <div class="stat-hint">未付本金 + 未付未减免利息 + 未付罚息</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">逾期率</div>
          <div class="stat-value">{{ stats.overdue_rate }}%</div>
          <div class="stat-hint">
            逾期借款 {{ stats.overdue_loans }} / 未结清借款 {{ stats.open_lent_loans }}（分母为 0 时显示 0%）
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">用户数</div>
          <div class="stat-value">{{ stats.user_count }}</div>
          <div class="stat-hint">已注册借款人数，不含管理员</div>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">逾期明细</h3>
        <el-table :data="overdue" size="small" border>
          <el-table-column prop="username" label="借款人" width="120" />
          <el-table-column prop="apply_no" label="申请编号" width="130" />
          <el-table-column prop="term_no" label="期次" width="70" align="center" />
          <el-table-column label="到期日" width="120">
            <template #default="{ row }">{{ fmtDate(row.due_date) }}</template>
          </el-table-column>
          <el-table-column prop="overdue_days" label="逾期天数" width="90" align="center" />
          <el-table-column label="未还本金" align="right">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.unpaid_principal) }}</span></template>
          </el-table-column>
          <el-table-column label="未还利息" align="right">
            <template #default="{ row }">{{ fmtMoney(row.unpaid_interest) }}</template>
          </el-table-column>
          <el-table-column label="未还罚息" align="right">
            <template #default="{ row }">{{ fmtMoney(row.unpaid_penalty) }}</template>
          </el-table-column>
          <el-table-column prop="plan_status" label="计划状态" width="180" />
          <template #empty><span class="muted">当前没有逾期期次</span></template>
        </el-table>
      </div>
    </div>
  </div>
</template>
