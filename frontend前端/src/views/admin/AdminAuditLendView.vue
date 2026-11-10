<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi } from '@/api'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import {
  fmtDateTime,
  fmtMoney,
  fmtRate,
  repayTypeLabel,
  statusLabel,
  statusType
} from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'

const statusFilter = ref('all')
const list = ref([])
const total = ref(0)
const page = reactive({ offset: 0, limit: 10 })
const loading = ref(false)
const loadError = ref('')

const detail = ref(null)
const detailVisible = ref(false)
const acting = ref(false)
const actionError = ref('')

const rejectOpinion = ref('')

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: '0', label: '待审核' },
  { value: '1', label: '待签约' },
  { value: '2', label: '待放款' },
  { value: '3', label: '已放款' },
  { value: '4', label: '已结清' },
  { value: '5', label: '已拒绝' },
  { value: '6', label: '已撤销' },
  { value: '7', label: '已失效' }
]

const canAudit = computed(() => detail.value?.status === 0)
const canLend = computed(() => detail.value?.status === 2)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await adminApi.applications({
      offset: page.offset,
      limit: page.limit,
      status: statusFilter.value
    })
    list.value = data.items
    total.value = data.total
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '申请列表加载失败'
  } finally {
    loading.value = false
  }
}

async function openDetail(row) {
  actionError.value = ''
  rejectOpinion.value = ''
  try {
    detail.value = await adminApi.applicationDetail(row.application_id)
    detailVisible.value = true
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '详情加载失败')
  }
}

/** 审批：状态冲突后刷新详情，不在客户端强制标记成功 */
async function audit(decision) {
  if (!detail.value) return
  if (decision === 'REJECT' && !rejectOpinion.value.trim()) {
    actionError.value = '拒绝时必须填写原因'
    return
  }
  try {
    await ElMessageBox.confirm(
      decision === 'APPROVE'
        ? `确认通过申请 ${detail.value.apply_no}？通过后借款人需在 72 小时内完成签约。`
        : `确认拒绝申请 ${detail.value.apply_no}？`,
      decision === 'APPROVE' ? '审批通过' : '审批拒绝',
      { type: 'warning' }
    )
  } catch {
    return
  }
  acting.value = true
  actionError.value = ''
  const scope = `ADMIN_AUDIT_${detail.value.application_id}_${decision}`
  try {
    await adminApi.audit(
      detail.value.application_id,
      { decision, opinion: rejectOpinion.value.trim() },
      idempotencyKey(scope)
    )
    releaseIdempotencyKey(scope)
    ElMessage.success(decision === 'APPROVE' ? '已通过' : '已拒绝')
    detail.value = await adminApi.applicationDetail(detail.value.application_id)
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : '审批失败'
    if (e instanceof ApiError && e.code === 'STATE_CONFLICT') {
      // 不在客户端强制标记成功，改为刷新真实状态
      detail.value = await adminApi.applicationDetail(detail.value.application_id).catch(() => detail.value)
      await load()
    }
  } finally {
    acting.value = false
  }
}

async function lend() {
  if (!detail.value) return
  try {
    await ElMessageBox.confirm(
      `确认对申请 ${detail.value.apply_no} 放款 ${fmtMoney(detail.value.amount)}？\n放款将增加借款人余额、生成还款计划并改变申请状态，不可撤销。`,
      '确认放款',
      { type: 'warning', confirmButtonText: '确认放款' }
    )
  } catch {
    return
  }
  acting.value = true
  actionError.value = ''
  const scope = `ADMIN_LEND_${detail.value.application_id}`
  try {
    await adminApi.lend(detail.value.application_id, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success('放款成功，已生成还款计划')
    detail.value = await adminApi.applicationDetail(detail.value.application_id)
    await load()
  } catch (e) {
    actionError.value = e instanceof ApiError ? e.message : '放款失败'
    if (e instanceof ApiError && ['STATE_CONFLICT', 'INSUFFICIENT_CREDIT', 'FORBIDDEN'].includes(e.code)) {
      detail.value = await adminApi.applicationDetail(detail.value.application_id).catch(() => detail.value)
      await load()
    }
  } finally {
    acting.value = false
  }
}

function onFilterChange() {
  page.offset = 0
  load()
}

onMounted(load)
</script>

<template>
  <div>
    <h2 class="page-title">审批与放款</h2>
    <p class="page-desc">
      审批通过后申请进入待签约；放款前系统会再次校验额度、黑名单与冻结状态，不以过去审批结果绕过。
    </p>

    <div class="toolbar">
      <el-select v-model="statusFilter" style="width: 140px" @change="onFilterChange">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <div class="spacer" />
      <el-button text @click="load">刷新</el-button>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />

    <template v-else>
      <el-table v-loading="loading" :data="list" size="small" border>
        <el-table-column prop="apply_no" label="申请编号" width="130" />
        <el-table-column prop="username" label="借款人" width="120" />
        <el-table-column prop="product_name" label="产品" min-width="140" />
        <el-table-column label="金额" align="right" width="120">
          <template #default="{ row }"><span class="money">{{ fmtMoney(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column prop="term" label="期数" width="70" align="center" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="150">
          <template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="openDetail(row)">处理</el-button>
          </template>
        </el-table-column>
        <template #empty><span class="muted">没有符合条件的申请</span></template>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :total="total"
          :page-size="page.limit"
          :current-page="page.offset / page.limit + 1"
          @current-change="(p) => { page.offset = (p - 1) * page.limit; load() }"
        />
      </div>
    </template>

    <el-drawer v-model="detailVisible" title="申请详情" size="560px">
      <template v-if="detail">
        <el-alert v-if="actionError" :title="actionError" type="error" show-icon :closable="false" class="mb" />

        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="申请编号">{{ detail.apply_no }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail.status)" size="small">{{ statusLabel(detail.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="借款人">{{ detail.username }}（ID {{ detail.user_id }}）</el-descriptions-item>
          <el-descriptions-item label="产品">{{ detail.product_name }}</el-descriptions-item>
          <el-descriptions-item label="金额">
            <span class="money">{{ fmtMoney(detail.amount) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="期数">{{ detail.term }} 期</el-descriptions-item>
          <el-descriptions-item label="用途">{{ detail.purpose || '—' }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmtDateTime(detail.created_at) }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.sign_deadline" label="签约截止">
            {{ fmtDateTime(detail.sign_deadline) }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="sub">规则快照</h4>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="年利率">{{ fmtRate(detail.rule_snapshot?.annual_rate) }}</el-descriptions-item>
          <el-descriptions-item label="还款方式">{{ repayTypeLabel(detail.rule_snapshot?.repay_type) }}</el-descriptions-item>
          <el-descriptions-item label="罚息日率">
            {{ fmtRate(detail.rule_snapshot?.penalty_daily_rate, { digits: 4 }) }}
          </el-descriptions-item>
          <el-descriptions-item label="结清费率">
            {{ fmtRate(detail.rule_snapshot?.prepay_fee_rate) }}
          </el-descriptions-item>
        </el-descriptions>

        <template v-if="canAudit">
          <h4 class="sub">审批</h4>
          <el-input
            v-model="rejectOpinion"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="审批意见（拒绝时必填）"
          />
          <div class="op-row">
            <el-button type="success" :loading="acting" @click="audit('APPROVE')">通过</el-button>
            <el-button type="danger" :loading="acting" @click="audit('REJECT')">拒绝</el-button>
          </div>
        </template>

        <template v-if="canLend">
          <h4 class="sub">放款</h4>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            description="放款会再次校验借款人额度、冻结与黑名单状态，并在同一事务中入账、生成还款计划。"
            class="mb"
          />
          <el-button type="primary" :loading="acting" @click="lend">确认放款</el-button>
        </template>

        <el-alert
          v-if="!canAudit && !canLend"
          type="info"
          :closable="false"
          show-icon
          :description="`当前状态「${statusLabel(detail.status)}」下无可用操作`"
          class="sub"
        />
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.mb {
  margin-bottom: 16px;
}
.sub {
  margin: 20px 0 10px;
  font-size: 14px;
  font-weight: 600;
}
.op-row {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}
</style>
