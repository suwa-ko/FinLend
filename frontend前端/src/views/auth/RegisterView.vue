<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '@/api'
import { ApiError } from '@/utils/request'
import { idempotencyKey, releaseIdempotencyKey } from '@/utils/idempotency'

const router = useRouter()
const route = useRoute()

const formRef = ref(null)
const loading = ref(false)
const sending = ref(false)
const countdown = ref(0)
const errorText = ref('')
let timer = null

const form = reactive({
  username: '',
  phone: '',
  password: '',
  confirmPassword: '',
  code: ''
})

const rules = {
  username: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { min: 3, max: 20, message: '账号长度 3–20 位', trigger: 'blur' }
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1\d{10}$/, message: '请输入 11 位手机号', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' }
  ],
  confirmPassword: [
    {
      validator: (_r, value, cb) => {
        if (!value) return cb(new Error('请再次输入密码'))
        if (value !== form.password) return cb(new Error('两次输入的密码不一致'))
        return cb()
      },
      trigger: 'blur'
    }
  ],
  code: [
    { required: true, message: '请输入验证码', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '验证码为 6 位数字', trigger: 'blur' }
  ]
}

const canSend = computed(() => /^1\d{10}$/.test(form.phone) && countdown.value === 0)

async function sendCode() {
  if (!canSend.value) {
    ElMessage.warning('请先填写正确的手机号')
    return
  }
  sending.value = true
  try {
    const data = await authApi.sendCode(form.phone)
    ElMessage.success(`验证码已发送（演示环境固定为 ${data.code}）`)
    countdown.value = 60
    timer = setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0) clearInterval(timer)
    }, 1000)
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '验证码发送失败'
  } finally {
    sending.value = false
  }
}

/** 注册使用固定幂等键范围，重复点击不会创建多个账号 */
const REGISTER_SCOPE = 'USER_REGISTER'

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorText.value = ''
  try {
    await authApi.register(
      {
        username: form.username,
        phone: form.phone,
        password: form.password,
        code: form.code
      },
      idempotencyKey(REGISTER_SCOPE)
    )
    releaseIdempotencyKey(REGISTER_SCOPE)
    ElMessage.success('注册成功，请登录')
    router.replace('/login')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '注册失败'
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// 保留 query.redirect，注册后返回原目标
const redirect = computed(() => route.query.redirect)
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-head">
        <h1 class="auth-title">注册账号</h1>
        <p class="auth-sub muted">注册后需完成模拟实名才能申请借款</p>
      </div>

      <el-alert v-if="errorText" :title="errorText" type="error" show-icon :closable="false" class="auth-alert" />

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" placeholder="3–20 位，唯一" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" placeholder="11 位手机号（可虚构）" maxlength="11" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password placeholder="再次输入密码" />
        </el-form-item>
        <el-form-item label="验证码" prop="code">
          <div class="code-row">
            <el-input v-model="form.code" placeholder="6 位数字" maxlength="6" />
            <el-button :disabled="!canSend" :loading="sending" @click="sendCode">
              {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
            </el-button>
          </div>
        </el-form-item>

        <el-button type="primary" class="auth-submit" :loading="loading" @click="submit">注册</el-button>
      </el-form>

      <div class="auth-links">
        <span class="muted">演示验证码固定为 888888</span>
        <router-link :to="{ path: '/login', query: { redirect } }">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #eef4ff 0%, #f6f8fa 55%, #ffffff 100%);
  padding: 24px;
}
.auth-card {
  width: 440px;
  max-width: 100%;
  background: #fff;
  border: 1px solid var(--finlend-border);
  border-radius: 12px;
  padding: 32px;
}
.auth-title {
  margin: 0 0 6px;
  font-size: 22px;
}
.auth-sub {
  margin: 0;
  font-size: 12px;
}
.auth-head {
  margin-bottom: 20px;
}
.auth-alert {
  margin-bottom: 16px;
}
.code-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.auth-submit {
  width: 100%;
}
.auth-links {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  font-size: 13px;
}
</style>
