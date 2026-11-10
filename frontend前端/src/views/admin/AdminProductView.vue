<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '@/api'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import { fmtMoney, fmtRate, repayTypeLabel } from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'

const list = ref([])
const loading = ref(false)
const loadError = ref('')

const dialogVisible = ref(false)
const editing = ref(false)
const saving = ref(false)
const formError = ref('')

const blank = () => ({
  id: '',
  name: '',
  repay_type: 1,
  annual_rate: '12.0000',
  min_amount: '1000.00',
  max_amount: '50000.00',
  min_term: 3,
  max_term: 24,
  penalty_daily_rate: '0.0500',
  prepay_fee_rate: '0.0000',
  status: 1
})

const form = reactive(blank())

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await adminApi.products({ limit: 100 })
    list.value = data.items
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '产品列表加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, blank())
  editing.value = false
  formError.value = ''
  dialogVisible.value = true
}

function openEdit(row) {
  Object.assign(form, row)
  editing.value = true
  formError.value = ''
  dialogVisible.value = true
}

function validate() {
  if (!form.name.trim()) return '产品名称必填'
  if (Number(form.min_amount) <= 0) return '金额下限须大于 0'
  if (Number(form.min_amount) > Number(form.max_amount)) return '金额下限不能大于上限'
  if (Number(form.min_term) < 1) return '期数下限须≥1'
  if (Number(form.min_term) > Number(form.max_term)) return '期数下限不能大于上限'
  if (Number(form.annual_rate) < 0) return '年利率不能为负'
  return ''
}

async function save() {
  const err = validate()
  if (err) {
    formError.value = err
    return
  }
  saving.value = true
  formError.value = ''
  const payload = {
    name: form.name.trim(),
    repay_type: Number(form.repay_type),
    annual_rate: String(form.annual_rate),
    min_amount: String(form.min_amount),
    max_amount: String(form.max_amount),
    min_term: Number(form.min_term),
    max_term: Number(form.max_term),
    penalty_daily_rate: String(form.penalty_daily_rate),
    prepay_fee_rate: String(form.prepay_fee_rate)
  }
  try {
    if (editing.value) {
      const scope = `ADMIN_PRODUCT_UPDATE_${form.id}_${JSON.stringify(payload)}`
      await adminApi.updateProduct(form.id, payload, idempotencyKey(scope))
      releaseIdempotencyKey(scope)
      ElMessage.success('产品已更新（不影响已有申请快照）')
    } else {
      const scope = `ADMIN_PRODUCT_CREATE_${payload.name}`
      await adminApi.createProduct(payload, idempotencyKey(scope))
      releaseIdempotencyKey(scope)
      ElMessage.success('产品已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function toggleStatus(row) {
  const next = row.status === 1 ? 0 : 1
  const scope = `ADMIN_PRODUCT_STATUS_${row.id}_${next}`
  try {
    await adminApi.setProductStatus(row.id, { status: next }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success(next === 1 ? '已上架' : '已下架（不能新增申请）')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败')
  }
}

onMounted(load)
</script>

<template>
  <div>
    <h2 class="page-title">产品管理</h2>
    <p class="page-desc">
      每个产品只对应一种还款方式，年利率上下限固定相等；产品变更不影响已提交申请的规则快照。下架后不能新增申请。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新建产品</el-button>
      <div class="spacer" />
      <el-button text @click="load">刷新</el-button>
    </div>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />

    <el-table v-else v-loading="loading" :data="list" size="small" border>
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="name" label="产品名称" min-width="160" />
      <el-table-column label="还款方式" width="110">
        <template #default="{ row }">{{ repayTypeLabel(row.repay_type) }}</template>
      </el-table-column>
      <el-table-column label="年利率" align="right" width="100">
        <template #default="{ row }">{{ fmtRate(row.annual_rate) }}</template>
      </el-table-column>
      <el-table-column label="金额区间" align="right" width="180">
        <template #default="{ row }">
          {{ fmtMoney(row.min_amount) }} – {{ fmtMoney(row.max_amount) }}
        </template>
      </el-table-column>
      <el-table-column label="期限" width="100" align="center">
        <template #default="{ row }">{{ row.min_term }}–{{ row.max_term }} 期</template>
      </el-table-column>
      <el-table-column label="罚息日率" align="right" width="100">
        <template #default="{ row }">{{ fmtRate(row.penalty_daily_rate, { digits: 4 }) }}</template>
      </el-table-column>
      <el-table-column label="结清费率" align="right" width="100">
        <template #default="{ row }">{{ fmtRate(row.prepay_fee_rate) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
            {{ row.status === 1 ? '上架' : '下架' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button text :type="row.status === 1 ? 'danger' : 'success'" size="small" @click="toggleStatus(row)">
            {{ row.status === 1 ? '下架' : '上架' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑产品' : '新建产品'" width="600px">
      <el-form label-width="100px">
        <el-form-item label="产品名称">
          <el-input v-model="form.name" maxlength="100" placeholder="不超过 100 字" />
        </el-form-item>
        <el-form-item label="还款方式">
          <el-radio-group v-model="form.repay_type">
            <el-radio :value="1">等额本息</el-radio>
            <el-radio :value="2">等额本金</el-radio>
            <el-radio :value="3">先息后本</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="年利率(%)">
          <el-input v-model="form.annual_rate" placeholder="例如 12.0000（百分数）" />
          <div class="hint">后端以百分数存储，12.0000 表示 12%</div>
        </el-form-item>
        <el-form-item label="金额下限">
          <el-input v-model="form.min_amount" />
        </el-form-item>
        <el-form-item label="金额上限">
          <el-input v-model="form.max_amount" />
        </el-form-item>
        <el-form-item label="期数下限">
          <el-input-number v-model="form.min_term" :min="1" :max="120" />
        </el-form-item>
        <el-form-item label="期数上限">
          <el-input-number v-model="form.max_term" :min="1" :max="120" />
        </el-form-item>
        <el-form-item label="罚息日利率">
          <el-input v-model="form.penalty_daily_rate" placeholder="例如 0.0500 表示 0.05%/日" />
        </el-form-item>
        <el-form-item label="结清费率">
          <el-input v-model="form.prepay_fee_rate" placeholder="默认 0.0000" />
        </el-form-item>
      </el-form>
      <el-alert v-if="formError" :title="formError" type="error" show-icon :closable="false" />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--finlend-muted);
  margin-top: 4px;
}
</style>
