<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi } from '@/api'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import { fmtDateTime, fmtMoney, maskPhone } from '@/utils/format'
import ErrorState from '@/components/ErrorState.vue'

const tab = ref('users')

const users = ref([])
const userTotal = ref(0)
const userPage = reactive({ offset: 0, limit: 10 })
const keyword = ref('')
const loading = ref(false)
const loadError = ref('')
const acting = ref(false)

const blacklist = ref([])
const blackTotal = ref(0)
const blackPage = reactive({ offset: 0, limit: 10 })

async function loadUsers() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await adminApi.users({
      offset: userPage.offset,
      limit: userPage.limit,
      keyword: keyword.value
    })
    users.value = data.items
    userTotal.value = data.total
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '用户列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadBlacklist() {
  try {
    const data = await adminApi.blacklist({ offset: blackPage.offset, limit: blackPage.limit })
    blacklist.value = data.items
    blackTotal.value = data.total
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : '黑名单加载失败'
  }
}

async function toggleFreeze(row) {
  const action = row.frozen ? '解冻' : '冻结'
  try {
    await ElMessageBox.confirm(
      row.frozen
        ? `确认解冻用户 ${row.username}？解冻后可正常登录与还款。`
        : `确认冻结用户 ${row.username}？冻结后其无法登录、续期、申请或放款；既有债务仍继续计罚息。`,
      `${action}用户`,
      { type: 'warning' }
    )
  } catch {
    return
  }
  acting.value = true
  const scope = `ADMIN_USER_STATUS_${row.user_id}_${!row.frozen}`
  try {
    await adminApi.setUserStatus(row.user_id, { frozen: !row.frozen }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success(`已${action}`)
    await loadUsers()
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : `${action}失败`)
  } finally {
    acting.value = false
  }
}

async function editCreditLine(row) {
  let value
  try {
    const res = await ElMessageBox.prompt(
      `当前授信 ${fmtMoney(row.credit_line)}，已占用 ${fmtMoney(row.occupied_credit)}。授信额度不得低于已占用额度。`,
      `调整 ${row.username} 的授信额度`,
      {
        inputValue: row.credit_line,
        inputPattern: /^\d+(\.\d{1,2})?$/,
        inputErrorMessage: '请输入非负金额（最多两位小数）',
        type: 'warning'
      }
    )
    value = res.value
  } catch {
    return
  }
  acting.value = true
  const scope = `ADMIN_CREDIT_${row.user_id}_${value}`
  try {
    await adminApi.setCreditLine(row.user_id, { credit_line: value }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success('授信额度已更新')
    await loadUsers()
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '调整失败')
  } finally {
    acting.value = false
  }
}

async function toggleBlacklist(row) {
  if (row.blacklisted) {
    try {
      await ElMessageBox.confirm(`确认将 ${row.username} 移出黑名单？`, '移出黑名单', { type: 'warning' })
    } catch {
      return
    }
    const scope = `ADMIN_BLACK_RM_${row.user_id}`
    try {
      await adminApi.removeBlacklist(row.user_id, idempotencyKey(scope))
      releaseIdempotencyKey(scope)
      ElMessage.success('已移出黑名单')
      await Promise.all([loadUsers(), loadBlacklist()])
    } catch (e) {
      ElMessage.error(e instanceof ApiError ? e.message : '操作失败')
    }
    return
  }

  let reason
  try {
    const res = await ElMessageBox.prompt(
      `将 ${row.username} 加入黑名单后，该用户不能发起新申请，也不能被放款；既有债务仍需偿还。`,
      '加入黑名单',
      {
        inputPlaceholder: '请填写拉黑原因（必填）',
        inputValidator: (v) => (v && v.trim() ? true : '原因必填'),
        type: 'warning'
      }
    )
    reason = res.value
  } catch {
    return
  }
  const scope = `ADMIN_BLACK_ADD_${row.user_id}`
  try {
    await adminApi.addBlacklist(row.user_id, { reason: reason.trim() }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    ElMessage.success('已加入黑名单')
    await Promise.all([loadUsers(), loadBlacklist()])
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败')
  }
}

function search() {
  userPage.offset = 0
  loadUsers()
}

function switchTab(name) {
  tab.value = name
  if (name === 'blacklist') loadBlacklist()
}

onMounted(loadUsers)
</script>

<template>
  <div>
    <h2 class="page-title">用户与黑名单</h2>
    <p class="page-desc">
      冻结是账号停用（已签发会话失效，但不清除欠款、不停止罚息）；黑名单只阻断新申请与放款，允许查询并偿还既有债务。
    </p>

    <el-tabs v-model="tab" @tab-change="switchTab">
      <el-tab-pane label="用户管理" name="users">
        <div class="toolbar">
          <el-input
            v-model="keyword"
            placeholder="按账号 / 手机号 / 昵称搜索"
            style="width: 260px"
            clearable
            @keyup.enter="search"
          />
          <el-button type="primary" plain @click="search">搜索</el-button>
          <div class="spacer" />
          <el-button text @click="loadUsers">刷新</el-button>
        </div>

        <ErrorState v-if="loadError" :message="loadError" @retry="loadUsers" />

        <template v-else>
          <el-table v-loading="loading" :data="users" size="small" border>
            <el-table-column prop="user_id" label="ID" width="60" />
            <el-table-column prop="username" label="账号" width="130" />
            <el-table-column label="手机号" width="130">
              <template #default="{ row }">{{ maskPhone(row.phone) }}</template>
            </el-table-column>
            <el-table-column label="实名" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.verified ? 'success' : 'info'" size="small">
                  {{ row.verified ? '已实名' : '未实名' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="授信" align="right" width="120">
              <template #default="{ row }"><span class="money">{{ fmtMoney(row.credit_line) }}</span></template>
            </el-table-column>
            <el-table-column label="已占用" align="right" width="110">
              <template #default="{ row }">{{ fmtMoney(row.occupied_credit) }}</template>
            </el-table-column>
            <el-table-column label="可用" align="right" width="110">
              <template #default="{ row }"><span class="money">{{ fmtMoney(row.available_credit) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="140">
              <template #default="{ row }">
                <el-tag v-if="row.frozen" type="danger" size="small">已冻结</el-tag>
                <el-tag v-else type="success" size="small">正常</el-tag>
                <el-tag v-if="row.blacklisted" type="warning" size="small" class="ml">黑名单</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="250">
              <template #default="{ row }">
                <el-button text type="primary" size="small" :loading="acting" @click="toggleFreeze(row)">
                  {{ row.frozen ? '解冻' : '冻结' }}
                </el-button>
                <el-button text size="small" :loading="acting" @click="editCreditLine(row)">调额</el-button>
                <el-button text :type="row.blacklisted ? 'success' : 'danger'" size="small" @click="toggleBlacklist(row)">
                  {{ row.blacklisted ? '移出黑名单' : '拉黑' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager">
            <el-pagination
              layout="prev, pager, next, total"
              :total="userTotal"
              :page-size="userPage.limit"
              :current-page="userPage.offset / userPage.limit + 1"
              @current-change="(p) => { userPage.offset = (p - 1) * userPage.limit; loadUsers() }"
            />
          </div>
        </template>
      </el-tab-pane>

      <el-tab-pane label="黑名单" name="blacklist">
        <el-table :data="blacklist" size="small" border>
          <el-table-column prop="user_id" label="用户 ID" width="80" />
          <el-table-column prop="username" label="账号" width="150" />
          <el-table-column label="手机号" width="140">
            <template #default="{ row }">{{ maskPhone(row.phone) }}</template>
          </el-table-column>
          <el-table-column prop="reason" label="拉黑原因" min-width="200" />
          <el-table-column label="加入时间" width="160">
            <template #default="{ row }">{{ fmtDateTime(row.created_at) }}</template>
          </el-table-column>
          <template #empty><span class="muted">黑名单为空</span></template>
        </el-table>
        <div class="pager">
          <el-pagination
            layout="prev, pager, next, total"
            :total="blackTotal"
            :page-size="blackPage.limit"
            :current-page="blackPage.offset / blackPage.limit + 1"
            @current-change="(p) => { blackPage.offset = (p - 1) * blackPage.limit; loadBlacklist() }"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.ml {
  margin-left: 6px;
}
</style>
