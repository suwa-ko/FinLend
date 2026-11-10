<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fileApi, userApi } from '@/api'
import { useSessionStore } from '@/stores/session'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'
import { fmtMoney, maskCardNo, maskIdCard, maskPhone } from '@/utils/format'

const session = useSessionStore()

const profileForm = reactive({ display_name: '' })
const savingProfile = ref(false)

const idForm = reactive({ real_name: '', id_card: '', file_id: '', fileName: '' })
const uploading = ref(false)
const submittingId = ref(false)

const cards = ref([])
const cardForm = reactive({ card_no: '', bank_name: '' })
const addingCard = ref(false)

const errorText = ref('')

const profile = computed(() => session.profile)

function syncProfile() {
  if (profile.value) profileForm.display_name = profile.value.display_name || ''
}

async function saveProfile() {
  if (!profileForm.display_name.trim()) {
    ElMessage.warning('昵称不能为空')
    return
  }
  savingProfile.value = true
  errorText.value = ''
  try {
    const scope = `PROFILE_UPDATE_${profileForm.display_name}`
    await userApi.updateMe({ display_name: profileForm.display_name.trim() }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    await session.fetchProfile()
    ElMessage.success('资料已更新')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '保存失败'
  } finally {
    savingProfile.value = false
  }
}

/** 前端先做格式/大小提示，服务端做最终校验（U02 输出与交互） */
function beforeUpload(file) {
  const okType = ['image/jpeg', 'image/png'].includes(file.type)
  if (!okType) {
    ElMessage.error('仅支持 JPEG / PNG 格式')
    return false
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片不能超过 5 MiB')
    return false
  }
  return true
}

async function onFileChange(uploadFile) {
  const raw = uploadFile.raw
  if (!raw) return
  if (!beforeUpload(raw)) return
  uploading.value = true
  errorText.value = ''
  try {
    const res = await fileApi.upload(raw)
    idForm.file_id = res.file_id
    idForm.fileName = res.name
    ElMessage.success('测试图片已上传')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '上传失败'
  } finally {
    uploading.value = false
  }
}

async function submitIdentity() {
  errorText.value = ''
  if (!idForm.real_name.trim()) {
    errorText.value = '请填写姓名'
    return
  }
  if (!/^\d{17}[\dXx]$/.test(idForm.id_card)) {
    errorText.value = '证件号须为 18 位'
    return
  }
  if (!idForm.file_id) {
    errorText.value = '请先上传测试证件图片'
    return
  }
  submittingId.value = true
  try {
    const scope = `IDENTITY_${idForm.id_card}`
    await userApi.submitIdentity(
      { real_name: idForm.real_name.trim(), id_card: idForm.id_card.toUpperCase(), file_id: idForm.file_id },
      idempotencyKey(scope)
    )
    releaseIdempotencyKey(scope)
    await session.fetchProfile()
    ElMessage.success('模拟实名认证成功（非真实身份核验）')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '提交失败'
  } finally {
    submittingId.value = false
  }
}

async function loadCards() {
  try {
    cards.value = await userApi.bankCards()
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '模拟卡加载失败'
  }
}

async function addCard() {
  errorText.value = ''
  const no = String(cardForm.card_no).replace(/\s/g, '')
  if (!/^\d{16,19}$/.test(no)) {
    errorText.value = '卡号须为 16–19 位数字'
    return
  }
  addingCard.value = true
  try {
    const scope = `CARD_ADD_${no}`
    await userApi.addBankCard({ card_no: no, bank_name: cardForm.bank_name || '模拟银行' }, idempotencyKey(scope))
    releaseIdempotencyKey(scope)
    cardForm.card_no = ''
    cardForm.bank_name = ''
    await loadCards()
    ElMessage.success('模拟卡已绑定（不参与资金划转）')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '绑定失败'
  } finally {
    addingCard.value = false
  }
}

async function setDefault(card) {
  try {
    await userApi.setDefaultCard(card.card_id, idempotencyKey(`CARD_DEFAULT_${card.card_id}`))
    releaseIdempotencyKey(`CARD_DEFAULT_${card.card_id}`)
    await loadCards()
    ElMessage.success('已设为默认卡（仅一张）')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '设置失败'
  }
}

async function removeCard(card) {
  try {
    await ElMessageBox.confirm(`确认删除模拟卡 ${maskCardNo(card.card_no)}？`, '删除模拟卡', {
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    await userApi.removeBankCard(card.card_id, idempotencyKey(`CARD_DEL_${card.card_id}`))
    releaseIdempotencyKey(`CARD_DEL_${card.card_id}`)
    await loadCards()
    ElMessage.success('已删除')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '删除失败'
  }
}

onMounted(async () => {
  if (!session.profile) await session.fetchProfile()
  syncProfile()
  loadCards()
})
</script>

<template>
  <div>
    <h2 class="page-title">资料与模拟实名</h2>
    <p class="page-desc">
      本页面所有身份信息均为虚构测试数据，图片为本人上传的测试证件图，系统仅做格式检查，<strong>不构成真实身份核验</strong>。
    </p>

    <el-alert v-if="errorText" :title="errorText" type="error" show-icon :closable="false" class="mb" />

    <div class="panel">
      <h3 class="panel-title">账户资料</h3>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="账号">{{ profile?.username }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ maskPhone(profile?.phone) }}</el-descriptions-item>
        <el-descriptions-item label="实名状态">
          <el-tag v-if="profile?.verified" type="success" size="small">已模拟实名</el-tag>
          <el-tag v-else type="warning" size="small">未实名（不能申请）</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="证件号">
          {{ profile?.verified ? maskIdCard(profile?.id_card) : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="账户余额">
          <span class="money">{{ fmtMoney(profile?.balance) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="授信额度">
          <span class="money">{{ fmtMoney(profile?.credit_line) }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <div class="profile-edit">
        <el-input v-model="profileForm.display_name" placeholder="昵称" style="width: 220px" maxlength="30" />
        <el-button :loading="savingProfile" @click="saveProfile">保存昵称</el-button>
      </div>
    </div>

    <div class="panel">
      <h3 class="panel-title">
        模拟实名认证
        <span class="mock-badge">非真实核验</span>
      </h3>
      <el-steps :active="profile?.verified ? 3 : idForm.file_id ? 1 : 0" align-center class="steps">
        <el-step title="填写姓名与证件号" />
        <el-step title="上传测试证件图" />
        <el-step title="提交并通过格式检查" />
      </el-steps>

      <el-form label-width="110px" class="id-form">
        <el-form-item label="姓名">
          <el-input v-model="idForm.real_name" placeholder="虚构姓名" maxlength="20" style="width: 240px" />
        </el-form-item>
        <el-form-item label="虚构证件号">
          <el-input
            v-model="idForm.id_card"
            placeholder="18 位虚构号码"
            maxlength="18"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item label="测试证件图">
          <div class="upload-row">
            <el-upload
              :auto-upload="false"
              :show-file-list="false"
              accept="image/jpeg,image/png"
              :on-change="onFileChange"
            >
              <el-button :loading="uploading">选择图片</el-button>
            </el-upload>
            <span v-if="idForm.file_id" class="ok-text">已上传：{{ idForm.fileName }}（file_id: {{ idForm.file_id }}）</span>
            <span v-else class="muted">JPEG / PNG，≤ 5 MiB。先上传得到 file_id 再提交。</span>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submittingId" :disabled="profile?.verified" @click="submitIdentity">
            {{ profile?.verified ? '已完成模拟实名' : '提交模拟实名' }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel">
      <h3 class="panel-title">模拟银行卡（不参与资金划转）</h3>
      <div class="card-add">
        <el-input v-model="cardForm.card_no" placeholder="16–19 位卡号（虚构）" style="width: 240px" maxlength="19" />
        <el-input v-model="cardForm.bank_name" placeholder="银行名称（可选）" style="width: 180px" />
        <el-button :loading="addingCard" @click="addCard">绑定模拟卡</el-button>
      </div>

      <el-table :data="cards" size="small" border class="mt">
        <el-table-column label="卡号">
          <template #default="{ row }">{{ maskCardNo(row.card_no) }}</template>
        </el-table-column>
        <el-table-column prop="bank_name" label="银行" width="160" />
        <el-table-column label="默认" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.is_default" type="success" size="small">默认</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button v-if="!row.is_default" text type="primary" size="small" @click="setDefault(row)">
              设为默认
            </el-button>
            <el-button text type="danger" size="small" @click="removeCard(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span class="muted">尚未绑定模拟卡</span>
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.profile-edit {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.steps {
  margin: 8px 0 20px;
}
.id-form {
  max-width: 640px;
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ok-text {
  font-size: 12px;
  color: #389e0d;
}
.card-add {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.mt {
  margin-top: 16px;
}
</style>
