<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { applicationApi, repaymentApi } from '@/api'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import { fmtDate, fmtDateTime, fmtMoney, planStatusLabel } from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id

const app = ref(null)
const plans = ref([])
const records = ref([])
const loading = ref(false)
const loadError = ref('')

const quote = ref(null)
const quoting = ref(false)
const settling = ref(false)
const paying = ref(false)
const actionError = ref('')
const unknownBanner = ref('')

const nextPlan = computed(() => plans.value.find((p) => p.status !== 1) || null)
const hasUnpaid = computed(() => plans.value.some((p) => p.status !== 1))
const canSettle = computed(() => app.value?.status === 3 && hasUnpaid.value)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [detail, planList, orderList] = await Promise.all([
      applicationApi.detail(id),
      repaymentApi.plans(id),
      repaymentApi.records(id)
    ])
    app.value = detail
    plans.value = planList
    records.value = orderList
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '还款数据加载失败'
  } finally {
    loading.value = false
  }
}

/** 普通还款：只结清最早到期的一期，不提供任意部分金额输入 */
async function repayNext() {
  if (!nextPlan.value) return
  const p = nextPlan.value
  const due = (Number(p.remaining_principal) + Number(p.interest) + Number(p.penalty)).toFixed(2)
  try {
    await ElMessageBox.confirm(
      `本期（第 ${p.term_no} 期）应还：本金 ${fmtMoney(p.remaining_principal)} + 利息 ${fmtMoney(
        p.interest
      )} + 罚息 ${fmtMoney(p.penalty)} = ${fmtMoney(due)}。确认还款？`,
      '确认还款',
      { type: 'info' }
    )
  } catch {
    return
  }
  paying.value = true
  actionError.value = ''
  unknownBanner.value = ''
  const scope = `REPAY_${id}_${p.plan_id}`
  try {
    await repaymentApi.repay(id, { plan_id: p.plan_id, confirm_amount: due }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success('还款成功')
    await load()
  } catch (e) {
    handleActionError(e, scope)
  } finally {
    paying.value = false
  }
}

function releaseKey(scope) {
  releaseIdempotencyKey(scope)
}

function handleActionError(e, scope) {
  if (e instanceof ApiError) {
    actionError.value = e.message
    if (e.unknown) {
      unknownBanner.value =
        '请求结果未知：请勿更换幂等键重复提交。请先点击「刷新」核对结果，确认未成功后再用原键重试。'
    } else if (e.code === 'AMOUNT_CHANGED') {
      quote.value = null
      actionError.value = '报价已变化，请重新获取结清报价后再确认'
    } else if (e.code !== 'IDEMPOTENCY_CONFLICT') {
      releaseKey(scope)
    }
  } else {
    actionError.value = '操作失败'
  }
}

/** 提前结清：先取报价，再确认总额 */
async function loadQuote() {
  quoting.value = true
  actionError.value = ''
  try {
    quote.value = await repaymentApi.settlementQuote(id)
  } catch (e) {
    quote.value = null
    actionError.value = e instanceof ApiError ? e.message : '获取结清报价失败'
  } finally {
    quoting.value = false
  }
}

async function confirmSettle() {
  if (!quote.value) return
  try {
    await ElMessageBox.confirm(
      `提前结清总额 ${fmtMoney(quote.value.total_amount)}，其中本金 ${fmtMoney(
        quote.value.principal
      )}、到期利息 ${fmtMoney(quote.value.due_interest)}、罚息 ${fmtMoney(
        quote.value.penalty
      )}、结清费 ${fmtMoney(quote.value.prepay_fee)}。确认？`,
      '确认整笔结清',
      { type: 'warning' }
    )
  } catch {
    return
  }
  settling.value = true
  actionError.value = ''
  unknownBanner.value = ''
  const scope = `SETTLE_${id}`
  try {
    await repaymentApi.settle(id, { confirm_amount: quote.value.total_amount }, idempotencyKey(scope))
    releaseKey(scope)
    ElMessage.success('提前结清成功')
    quote.value = null
    await load()
  } catch (e) {
    handleActionError(e, scope)
  } finally {
    settling.value = false
  }
}

onMounted(load)
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
      <h2 class="page-title">还款与结清</h2>
      <p class="page-desc">
        普通还款一次结清最早到期的整期债务，不支持任意部分还款；提前还款仅支持整笔结清。
      </p>

      <el-alert v-if="unknownBanner" :title="unknownBanner" type="warning" show-icon :closable="false" class="mb" />
      <el-alert v-if="actionError" :title="actionError" type="error" show-icon :closable="false" class="mb" />

      <div class="panel" v-if="app">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="申请编号">{{ app.apply_no }}</el-descriptions-item>
          <el-descriptions-item label="产品">{{ app.product_name }}</el-descriptions-item>
          <el-descriptions-item label="借款金额">
            <span class="money">{{ fmtMoney(app.amount) }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="panel">
        <h3 class="panel-title">还款计划</h3>
        <el-table :data="plans" size="small" border max-height="380">
          <el-table-column prop="term_no" label="期次" width="70" align="center" />
          <el-table-column label="到期日" width="120">
            <template #default="{ row }">{{ fmtDate(row.due_date) }}</template>
          </el-table-column>
          <el-table-column label="应还本金" align="right">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.remaining_principal) }}</span></template>
          </el-table-column>
          <el-table-column label="利息" align="right">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.interest) }}</span></template>
          </el-table-column>
          <el-table-column label="罚息" align="right">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.penalty) }}</span></template>
          </el-table-column>
          <el-table-column label="减免利息" align="right">
            <template #default="{ row }"><span class="money muted">{{ fmtMoney(row.waived_interest) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : row.status === 2 ? 'danger' : 'info'" size="small">
                {{ planStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel" v-if="nextPlan">
        <h3 class="panel-title">普通还款（最早到期期）</h3>
        <div class="repay-box">
          <div>
            <div class="muted small">第 {{ nextPlan.term_no }} 期 · 到期日 {{ fmtDate(nextPlan.due_date) }}</div>
            <div class="repay-amount money">
              {{
                fmtMoney(
                  Number(nextPlan.remaining_principal) + Number(nextPlan.interest) + Number(nextPlan.penalty)
                )
              }}
            </div>
            <div class="muted small">
              本金 {{ fmtMoney(nextPlan.remaining_principal) }} + 利息 {{ fmtMoney(nextPlan.interest) }} +
              罚息 {{ fmtMoney(nextPlan.penalty) }}
            </div>
          </div>
          <el-button type="primary" :loading="paying" @click="repayNext">确认还款本期</el-button>
        </div>
      </div>

      <div class="panel" v-if="canSettle">
        <h3 class="panel-title">提前结清（整笔）</h3>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          description="未到期的利息会记为减免，不会额外收取；若报价与确认时不一致，系统会要求重新确认。"
          class="mb"
        />
        <el-button :loading="quoting" @click="loadQuote">获取结清报价</el-button>

        <div v-if="quote" class="quote-box">
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="业务日期">{{ quote.business_date }}</el-descriptions-item>
            <el-descriptions-item label="未还本金">
              <span class="money">{{ fmtMoney(quote.principal) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="到期利息/罚息">
              <span class="money">{{ fmtMoney(Number(quote.due_interest) + Number(quote.penalty)) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="当期日息">{{ fmtMoney(quote.current_interest) }}</el-descriptions-item>
            <el-descriptions-item label="结清费">{{ fmtMoney(quote.prepay_fee) }}</el-descriptions-item>
            <el-descriptions-item label="减免利息">
              <span class="muted">{{ fmtMoney(quote.waived_interest) }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <div class="total-row">
            <span>结清总额</span>
            <span class="total money">{{ fmtMoney(quote.total_amount) }}</span>
          </div>
          <el-button type="danger" :loading="settling" @click="confirmSettle">确认整笔结清</el-button>
        </div>
      </div>

      <div class="panel">
        <h3 class="panel-title">还款记录</h3>
        <el-table :data="records" size="small" border>
          <el-table-column prop="repay_no" label="还款编号" width="180" />
          <el-table-column label="金额" align="right">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.amount) }}</span></template>
          </el-table-column>
          <el-table-column label="其中本金" align="right">
            <template #default="{ row }">{{ fmtMoney(row.principal) }}</template>
          </el-table-column>
          <el-table-column label="其中利息" align="right">
            <template #default="{ row }">{{ fmtMoney(row.interest) }}</template>
          </el-table-column>
          <el-table-column label="其中罚息" align="right">
            <template #default="{ row }">{{ fmtMoney(row.penalty) }}</template>
          </el-table-column>
          <el-table-column label="记账后余额" align="right">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.balance_after) }}</span></template>
          </el-table-column>
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template>
          </el-table-column>
          <template #empty><span class="muted">暂无还款记录</span></template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.small {
  font-size: 12px;
}
.repay-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.repay-amount {
  font-size: 26px;
  font-weight: 700;
  margin: 6px 0;
  color: #cf1322;
}
.quote-box {
  margin-top: 16px;
}
.total-row {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 12px;
  margin: 12px 0;
}
.total {
  font-size: 24px;
  color: #cf1322;
}
</style>
