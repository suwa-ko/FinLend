<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productApi } from '@/api'
import { ApiError } from '@/utils/request'
import { fmtNumber, fmtRate, repayTypeLabel } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'

const route = useRoute()
const router = useRouter()

const products = ref([])
const loading = ref(false)
const loadError = ref('')

const selectedId = ref(route.params.id || '')
const quoteForm = reactive({ amount: '', term: 12 })
const quote = ref(null)
const quoting = ref(false)
const quoteError = ref('')

const selected = computed(() => products.value.find((p) => p.id === String(selectedId.value)) || null)

const amountRange = computed(() => {
  if (!selected.value) return { min: 0, max: 0 }
  return { min: Number(selected.value.min_amount), max: Number(selected.value.max_amount) }
})

async function loadProducts() {
  loading.value = true
  loadError.value = ''
  try {
    products.value = await productApi.list()
    if (!selectedId.value && products.value.length) {
      selectedId.value = products.value[0].id
    }
    applyDefaults()
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '产品列表加载失败'
  } finally {
    loading.value = false
  }
}

function applyDefaults() {
  if (!selected.value) return
  if (!quoteForm.amount) quoteForm.amount = selected.value.min_amount
  if (quoteForm.term < selected.value.min_term || quoteForm.term > selected.value.max_term) {
    quoteForm.term = Math.min(12, selected.value.max_term)
  }
  quote.value = null
  quoteError.value = ''
}

function pick(p) {
  selectedId.value = p.id
  router.replace({ path: `/products/${p.id}` })
  applyDefaults()
}

async function runQuote() {
  if (!selected.value) return
  quoteError.value = ''
  if (!(Number(quoteForm.amount) > 0)) {
    quoteError.value = '请输入借款金额'
    return
  }
  quoting.value = true
  try {
    quote.value = await productApi.quote({
      product_id: selected.value.id,
      amount: String(quoteForm.amount),
      term: Number(quoteForm.term)
    })
    ElMessage.success('试算完成（金额由后端计算）')
  } catch (e) {
    quote.value = null
    quoteError.value = e instanceof ApiError ? e.message : '试算失败'
  } finally {
    quoting.value = false
  }
}

function goApply() {
  if (!selected.value) return
  router.push({
    path: '/applications',
    query: {
      product_id: selected.value.id,
      amount: quoteForm.amount,
      term: quoteForm.term,
      apply: '1'
    }
  })
}

watch(selectedId, () => applyDefaults())
onMounted(loadProducts)
</script>

<template>
  <div>
    <h2 class="page-title">贷款产品</h2>
    <p class="page-desc">
      浏览产品并试算。试算金额与逐期计划均以服务端返回结果为准，客户端不自行计算成交利率或应还金额。
    </p>

    <ErrorState v-if="loadError" :message="loadError" @retry="loadProducts" />

    <template v-else>
      <div v-loading="loading" class="product-grid">
        <div
          v-for="p in products"
          :key="p.id"
          class="product-card"
          :class="{ active: String(selectedId) === p.id }"
          @click="pick(p)"
        >
          <div class="pc-head">
            <span class="pc-name">{{ p.name }}</span>
            <el-tag size="small" effect="plain">{{ repayTypeLabel(p.repay_type) }}</el-tag>
          </div>
          <div class="pc-rate">
            <span class="rate-num">{{ fmtRate(p.annual_rate) }}</span>
            <span class="muted">年利率</span>
          </div>
          <div class="pc-meta muted">
            额度 {{ fmtNumber(p.min_amount) }}–{{ fmtNumber(p.max_amount) }} 元 ·
            期限 {{ p.min_term }}–{{ p.max_term }} 期
          </div>
        </div>
      </div>

      <EmptyState v-if="!loading && !products.length" description="暂无可借产品（可能均已下架）" />

      <div v-if="selected" class="panel">
        <h3 class="panel-title">试算</h3>
        <el-form label-width="90px" class="quote-form">
          <el-form-item label="借款金额">
            <el-input-number
              v-model="quoteForm.amount"
              :min="amountRange.min"
              :max="amountRange.max"
              :step="100"
              controls-position="right"
              style="width: 220px"
            />
            <span class="muted unit">元（{{ fmtNumber(selected.min_amount) }}–{{ fmtNumber(selected.max_amount) }}）</span>
          </el-form-item>
          <el-form-item label="借款期数">
            <el-input-number
              v-model="quoteForm.term"
              :min="selected.min_term"
              :max="selected.max_term"
              controls-position="right"
              style="width: 160px"
            />
            <span class="muted unit">期（{{ selected.min_term }}–{{ selected.max_term }}）</span>
          </el-form-item>
          <el-form-item label="费率说明">
            <div class="muted small">
              罚息日利率 {{ fmtRate(selected.penalty_daily_rate, { digits: 4 }) }} ·
              提前结清费率 {{ fmtRate(selected.prepay_fee_rate, { digits: 2 }) }}
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="quoting" @click="runQuote">开始试算</el-button>
            <el-button @click="goApply">去申请</el-button>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="quoteError"
          :title="quoteError"
          type="error"
          show-icon
          :closable="false"
          class="quote-alert"
        />

        <template v-if="quote">
          <div class="stat-row quote-stats">
            <div class="stat-card">
              <div class="stat-label">总利息</div>
              <div class="stat-value money">{{ fmtNumber(quote.total_interest) }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">本息合计</div>
              <div class="stat-value money">{{ fmtNumber(quote.total_amount) }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">还款方式</div>
              <div class="stat-value">{{ repayTypeLabel(quote.repay_type) }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">预计首期到期日</div>
              <div class="stat-value">{{ quote.first_due_date }}</div>
              <div class="stat-hint">{{ quote.note }}</div>
            </div>
          </div>

          <el-table :data="quote.schedule" size="small" border max-height="360" class="schedule">
            <el-table-column prop="term_no" label="期次" width="80" />
            <el-table-column label="应还本金" align="right">
              <template #default="{ row }"><span class="money">{{ fmtNumber(row.principal) }}</span></template>
            </el-table-column>
            <el-table-column label="应还利息" align="right">
              <template #default="{ row }"><span class="money">{{ fmtNumber(row.interest) }}</span></template>
            </el-table-column>
            <el-table-column label="本期合计" align="right">
              <template #default="{ row }"><span class="money">{{ fmtNumber(row.amount) }}</span></template>
            </el-table-column>
          </el-table>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
  min-height: 60px;
}
.product-card {
  border: 1px solid var(--finlend-border);
  border-radius: 8px;
  padding: 16px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}
.product-card:hover {
  border-color: var(--finlend-primary);
}
.product-card.active {
  border-color: var(--finlend-primary);
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.12);
}
.pc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.pc-name {
  font-weight: 600;
}
.pc-rate {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 10px;
}
.rate-num {
  font-size: 24px;
  font-weight: 700;
  color: #cf1322;
  font-variant-numeric: tabular-nums;
}
.pc-meta {
  font-size: 12px;
}
.unit {
  margin-left: 8px;
  font-size: 12px;
}
.small {
  font-size: 12px;
}
.quote-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.quote-alert {
  margin-bottom: 14px;
}
.quote-stats {
  margin: 16px 0;
}
.schedule {
  margin-top: 8px;
}
</style>
