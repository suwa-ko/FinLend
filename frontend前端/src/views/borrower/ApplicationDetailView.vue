<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { applicationApi } from '@/api'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import {
  countdownText,
  fmtDateTime,
  fmtMoney,
  fmtRate,
  repayTypeLabel,
  statusLabel,
  statusType
} from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'

const route = useRoute()
const router = useRouter()

const id = route.params.id
const app = ref(null)
const loading = ref(false)
const loadError = ref('')
const acting = ref(false)
const actionError = ref('')

const now = ref(new Date())
let timer = null

const canCancel = computed(() => app.value?.status === 0)
const signCountdown = computed(() => countdownText(app.value?.sign_deadline, now.value))
const canSign = computed(() => app.value?.status === 1 && !signCountdown.value.expired)
const signExpired = computed(() => app.value?.status === 1 && signCountdown.value.expired)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    app.value = await applicationApi.detail(id)
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '申请详情加载失败'
  } finally {
    loading.value = false
  }
}

async function cancel() {
  try {
    await ElMessageBox.confirm(
      '撤销后该申请将关闭，需要重新提交才能再次借款。确认撤销？',
      '撤销申请',
      { type: 'warning' }
    )
  } catch {
    return
  }
  acting.value = true
  actionError.value = ''
  const scope = `CANCEL_${id}`
  try {
    await applicationApi.cancel(id, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success('申请已撤销')
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : '撤销失败'
    if (e instanceof ApiError && e.code === 'STATE_CONFLICT') await load()
  } finally {
    acting.value = false
  }
}

async function sign() {
  try {
    await ElMessageBox.confirm(
      '签约即确认借款规则快照：利率、还款方式、罚息与费用在借款期内保持不变。确认签约？',
      '确认签约',
      { type: 'info' }
    )
  } catch {
    return
  }
  acting.value = true
  actionError.value = ''
  const scope = `SIGN_${id}`
  try {
    await applicationApi.sign(id, { confirmed: true }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success('签约成功，等待管理员放款')
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : '签约失败'
    if (e instanceof ApiError && e.code === 'STATE_CONFLICT') await load()
  } finally {
    acting.value = false
  }
}

onMounted(() => {
  load()
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <div class="toolbar">
      <el-button text @click="router.back()">← 返回</el-button>
      <div class="spacer" />
      <el-button text @click="load">刷新</el-button>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />

    <div v-else v-loading="loading">
      <template v-if="app">
        <h2 class="page-title">
          申请详情
          <el-tag :type="statusType(app.status)" size="small" class="head-tag">{{ statusLabel(app.status) }}</el-tag>
        </h2>
        <p class="page-desc">申请编号 {{ app.apply_no }} · 提交于 {{ fmtDateTime(app.created_at) }}</p>

        <el-alert v-if="actionError" :title="actionError" type="error" show-icon :closable="false" class="mb" />

        <el-alert
          v-if="signExpired"
          title="签约已超时"
          type="warning"
          show-icon
          :closable="false"
          description="审批通过后 72 小时内未签约，该申请将记为已失效且不能放款。请刷新页面查看最新状态。"
          class="mb"
        />

        <div class="panel">
          <h3 class="panel-title">申请信息</h3>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="产品">{{ app.product_name }}</el-descriptions-item>
            <el-descriptions-item label="借款金额">
              <span class="money">{{ fmtMoney(app.amount) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="期数">{{ app.term }} 期</el-descriptions-item>
            <el-descriptions-item label="借款用途">{{ app.purpose || '—' }}</el-descriptions-item>
            <el-descriptions-item v-if="app.audit_opinion" label="审批意见" :span="2">
              {{ app.audit_opinion }}
            </el-descriptions-item>
            <el-descriptions-item v-if="app.sign_deadline" label="签约截止" :span="2">
              {{ fmtDateTime(app.sign_deadline) }}（北京时间）
              <span v-if="app.status === 1" class="countdown">
                剩余 {{ signCountdown.text }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="panel">
          <h3 class="panel-title">规则快照（签约即锁定，产品后续修改不影响本申请）</h3>
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="年利率">{{ fmtRate(app.rule_snapshot?.annual_rate) }}</el-descriptions-item>
            <el-descriptions-item label="还款方式">
              {{ repayTypeLabel(app.rule_snapshot?.repay_type) }}
            </el-descriptions-item>
            <el-descriptions-item label="罚息日利率">
              {{ fmtRate(app.rule_snapshot?.penalty_daily_rate, { digits: 4 }) }}
            </el-descriptions-item>
            <el-descriptions-item label="提前结清费率">
              {{ fmtRate(app.rule_snapshot?.prepay_fee_rate) }}
            </el-descriptions-item>
            <el-descriptions-item label="金额区间">
              {{ fmtMoney(app.rule_snapshot?.min_amount) }} – {{ fmtMoney(app.rule_snapshot?.max_amount) }}
            </el-descriptions-item>
            <el-descriptions-item label="期数">{{ app.rule_snapshot?.term }} 期</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="panel actions">
          <el-button v-if="canCancel" type="danger" plain :loading="acting" @click="cancel">
            撤销申请
          </el-button>
          <el-button v-if="canSign" type="primary" :loading="acting" @click="sign">确认签约</el-button>
          <el-button v-if="app.status === 3 || app.status === 4" type="success" @click="router.push(`/repayment/${app.application_id}`)">
            查看还款计划
          </el-button>
          <span v-if="!canCancel && !canSign" class="muted">
            {{ app.status === 0 ? '' : '当前状态下没有可执行的操作' }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.head-tag {
  margin-left: 8px;
  vertical-align: middle;
}
.mb {
  margin-bottom: 16px;
}
.countdown {
  margin-left: 10px;
  color: #cf1322;
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
