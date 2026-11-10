<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useSessionStore } from '@/stores/session'
import { ApiError } from '@/utils/request'
import { randomId } from '@/utils/idempotency'

const session = useSessionStore()
const router = useRouter()
const route = useRoute()

const formRef = ref(null)
const loading = ref(false)
const errorText = ref('')

// 设备标识：Web 与 App 会话独立，登录时携带 client_type=WEB
const deviceId = (() => {
  const KEY = 'finlend.device_id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `web-${randomId(16)}`
    localStorage.setItem(KEY, id)
  }
  return id
})()

const form = reactive({
  username: '',
  password: '',
  remember: true
})

const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

onMounted(() => {
  if (route.query.expired) errorText.value = '登录状态已过期，请重新登录'
})

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorText.value = ''
  try {
    await session.login({
      username: form.username,
      password: form.password,
      device_id: deviceId
    })
    ElMessage.success('登录成功')
    router.replace(route.query.redirect || '/products')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function fillDemo() {
  form.username = 'demo_user'
  form.password = 'demo1234'
}

/** 进入管理端前先结束当前借款人会话，避免两种身份凭证共存 */
async function goAdmin() {
  await session.logout()
  router.push('/admin/login')
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-head">
        <h1 class="auth-title">FinLend 借款人端</h1>
        <p class="auth-sub muted">课程演示平台 · 虚构身份与模拟资金</p>
      </div>

      <el-alert
        v-if="errorText"
        :title="errorText"
        type="error"
        show-icon
        :closable="false"
        class="auth-alert"
      />

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" placeholder="请输入账号" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" class="auth-submit" :loading="loading" @click="submit">
          登录
        </el-button>
      </el-form>

      <div class="auth-links">
        <router-link to="/register">注册新账号</router-link>
        <a href="javascript:void(0)" @click="goAdmin">管理员入口</a>
      </div>

      <el-divider>演示账号</el-divider>
      <div class="demo-box muted">
        <div>已实名借款人：demo_user / demo1234</div>
        <div>未实名用户：newbie / newbie1234</div>
        <el-button text type="primary" size="small" @click="fillDemo">一键填入</el-button>
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
  width: 400px;
  max-width: 100%;
  background: #fff;
  border: 1px solid var(--finlend-border);
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.06);
}
.auth-head {
  margin-bottom: 20px;
}
.auth-title {
  margin: 0 0 6px;
  font-size: 22px;
}
.auth-sub {
  margin: 0;
  font-size: 12px;
}
.auth-alert {
  margin-bottom: 16px;
}
.auth-submit {
  width: 100%;
  margin-top: 4px;
}
.auth-links {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  font-size: 13px;
}
.demo-box {
  font-size: 12px;
  line-height: 1.9;
}
</style>
