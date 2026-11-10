<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { accountApi } from '@/api'
import { ApiError } from '@/utils/request'
import { fmtDateTime, fmtMoney } from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'
import EmptyState from '@/components/EmptyState.vue'

const router = useRouter()

const overview = ref(null)
const flows = ref([])
const total = ref(0)
const page = reactive({ offset: 0, limit: 10 })
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [acc, flowPage] = await Promise.all([
      accountApi.overview(),
      accountApi.flows({ offset: page.offset, limit: page.limit })
    ])
    overview.value = acc
    flows.value = flowPage.items
    total.value = flowPage.total
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '账户数据加载失败'
  } finally {
    loading.value = false
  }
}

function onPageChange(p) {
  page.offset = (p - 1) * page.limit
  load()
}
</script>

<template>
  <div>
    <h2 class="page-title">我的账户</h2>
    <p class="page-desc">
      授信额度不等于账户余额：授信只按未还本金占用，归还本金后立即释放；余额是模拟现金，放款入账、还款出账。
    </p>

    <ErrorState v-if="loadError" :message="loadError" @retry="load" />

    <div v-else v-loading="loading">
      <div class="stat-row" v-if="overview">
        <div class="stat-card">
          <div class="stat-label">账户余额</div>
          <div class="stat-value money">{{ fmtMoney(overview.balance) }}</div>
          <div class="stat-hint">模拟现金，不是授信额度</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">授信额度</div>
          <div class="stat-value money">{{ fmtMoney(overview.credit_line) }}</div>
          <div class="stat-hint">管理员可调整</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已占用授信</div>
          <div class="stat-value money">{{ fmtMoney(overview.occupied_credit) }}</div>
          <div class="stat-hint">已放款未结清的未还本金</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">可用额度</div>
          <div class="stat-value money">{{ fmtMoney(overview.available_credit) }}</div>
          <div class="stat-hint">max(0, 授信 − 占用)</div>
        </div>
      </div>

      <div class="panel">
        <div class="toolbar" style="margin-bottom: 12px">
          <h3 class="panel-title" style="margin: 0">账户流水</h3>
          <div class="spacer" />
          <el-button text @click="load">刷新</el-button>
        </div>
        <el-table :data="flows" size="small" border>
          <el-table-column label="方向" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.direction === 'IN' ? 'success' : 'warning'" size="small">
                {{ row.direction === 'IN' ? '入账' : '出账' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="金额" align="right" width="140">
            <template #default="{ row }">
              <span :class="['money', row.direction === 'IN' ? 'in' : 'out']">
                {{ row.direction === 'IN' ? '+' : '-' }}{{ fmtMoney(row.amount) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="记账后余额" align="right" width="150">
            <template #default="{ row }"><span class="money">{{ fmtMoney(row.balance_after) }}</span></template>
          </el-table-column>
          <el-table-column prop="biz_no" label="业务编号" width="180" />
          <el-table-column prop="remark" label="摘要" min-width="160" />
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template>
          </el-table-column>
          <template #empty>
            <EmptyState description="暂无流水（新注册账户余额为 0）" />
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
      </div>

      <div class="panel">
        <h3 class="panel-title">快捷入口</h3>
        <el-button @click="router.push('/applications')">查看我的申请</el-button>
        <el-button @click="router.push('/products')">继续借款</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.in {
  color: #389e0d;
}
.out {
  color: #cf1322;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
