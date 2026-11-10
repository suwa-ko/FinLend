<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { applicationApi, productApi } from '@/api'
import { useSessionStore } from '@/stores/session'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import { fmtDateTime, fmtMoney, statusLabel, statusType } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const list = ref([])
const total = ref(0)
const page = reactive({ offset: 0, limit: 20 })
const loading = ref(false)
const loadError = ref('')

const products = ref([])
const showApply = ref(false)
const applyForm = reactive({ product_id: '', amount: '', term: 12, purpose: '' })
const submitting = ref(false)
const submitError = ref('')
const lastUnknown = ref(false)

const filteredProducts = computed(() => products.value)
const selectedProduct = computed(
  () => products.value.find((p) => String(p.id) === String(applyForm.product_id)) || null
)

async function loadList() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await applicationApi.list({ offset: page.offset, limit: page.limit })
    list.value = data.items
    total.value = data.total
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '申请列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadProducts() {
  try {
    products.value = await productApi.list()
  } catch {
    products.value = []
  }
}

function openApply() {
  if (!session.isVerified) {
    ElMessage.warning('尚未完成模拟实名，请先前往「资料与实名」完成认证')
    router.push('/profile')
    return
  }
  showApply.value = true
  submitError.value = ''
  lastUnknown.value = false
  if (route.query.product_id) applyForm.product_id = String(route.query.product_id)
  if (route.query.amount) applyForm.amount = String(route.query.amount)
  if (route.query.term) applyForm.term = Number(route.query.term)
  if (!applyForm.product_id && products.value.length) applyForm.product_id = products.value[0].id
}

async function submitApply() {
  submitError.value = ''
  if (!applyForm.product_id) {
    submitError.value = '请选择产品'
    return
  }
  if (!(Number(applyForm.amount) > 0)) {
    submitError.value = '请输入借款金额'
    return
  }
  submitting.value = true
  lastUnknown.value = false
  // 幂等键固定在「一次提交表单」范围内：超时重试沿用原键
  const scope = `APPLICATION_CREATE_${applyForm.product_id}`
  try {
    const app = await applicationApi.create(
      {
        product_id: String(applyForm.product_id),
        amount: String(applyForm.amount),
        term: Number(applyForm.term),
        purpose: applyForm.purpose.trim()
      },
      idempotencyKey(scope)
    )
    releaseIdempotencyKey(scope)
    ElMessage.success('申请已提交，等待管理员审核')
    showApply.value = false
    router.push(`/applications/${app.application_id}`)
  } catch (e) {
    if (e instanceof ApiError) {
      submitError.value = e.message
      if (e.unknown) {
        // 结果未知：不释放原键，提示先查询或以相同幂等键重试
        lastUnknown.value = true
      } else if (e.code !== 'IDEMPOTENCY_CONFLICT') {
        releaseIdempotencyKey(scope)
      }
    } else {
      submitError.value = '提交失败'
    }
  } finally {
    submitting.value = false
  }
}

function viewDetail(row) {
  router.push(`/applications/${row.application_id}`)
}

function gotoRepay(row) {
  router.push(`/repayment/${row.application_id}`)
}

function onPageChange(p) {
  page.offset = (p - 1) * page.limit
  loadList()
}

onMounted(() => {
  loadList()
  loadProducts()
  if (route.query.apply === '1') openApply()
})
</script>

<template>
  <div>
    <h2 class="page-title">我的借款申请</h2>
    <p class="page-desc">
      同一用户最多一笔待审核申请；只有待审核状态可撤销；审批通过后需在 72 小时内完成签约。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openApply">发起借款申请</el-button>
      <div class="spacer" />
      <el-button text @click="loadList">刷新</el-button>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="loadList" />

    <template v-else>
      <el-table v-loading="loading" :data="list" border size="small">
        <el-table-column prop="apply_no" label="申请编号" width="130" />
        <el-table-column prop="product_name" label="产品" min-width="150" />
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
        <el-table-column label="操作" width="190">
          <template #default="{ row }">
            <el-button text type="primary" size="small" @click="viewDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 3"
              text
              type="success"
              size="small"
              @click="gotoRepay(row)"
            >
              还款
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState description="还没有借款申请" action-text="发起申请" @action="openApply" />
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

    <el-dialog v-model="showApply" title="发起借款申请" width="560px" :close-on-click-modal="false">
      <div v-if="lastUnknown" class="unknown-banner">
        上次提交结果未知（可能已成功）。请先到「我的申请」查看是否已生成申请；若确认没有，可用相同内容再次提交（系统不会重复创建）。
      </div>

      <el-form label-width="90px">
        <el-form-item label="产品">
          <el-select v-model="applyForm.product_id" placeholder="选择产品" style="width: 100%">
            <el-option
              v-for="p in filteredProducts"
              :key="p.id"
              :label="p.name"
              :value="String(p.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number
            v-model="applyForm.amount"
            :min="selectedProduct ? Number(selectedProduct.min_amount) : 0"
            :max="selectedProduct ? Number(selectedProduct.max_amount) : 50000"
            :step="100"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="期数">
          <el-input-number
            v-model="applyForm.term"
            :min="selectedProduct ? selectedProduct.min_term : 1"
            :max="selectedProduct ? selectedProduct.max_term : 24"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="借款用途">
          <el-input
            v-model="applyForm.purpose"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="可选，不超过 200 字"
          />
        </el-form-item>
      </el-form>

      <el-alert v-if="submitError" :title="submitError" type="error" show-icon :closable="false" />

      <template #footer>
        <el-button @click="showApply = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitApply">提交申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
