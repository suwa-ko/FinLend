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

const deviceId = (() => {
  const KEY = 'finlend.device_id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `web-${randomId(16)}`
    localStorage.setItem(KEY, id)
  }
  return id
})()

const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入管理员账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

onMounted(() => {
  if (route.query.expired) errorText.value = '管理端会话已过期，请重新登录'
})

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorText.value = ''
  try {
    await session.adminLogin({ username: form.username, password: form.password, device_id: deviceId })
    ElMessage.success('管理端登录成功')
    // redirect 只接受管理端路径，避免把管理员送到借款人页面后又被守卫弹回
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    router.replace(redirect.startsWith('/admin') ? redirect : '/admin/users')
  } catch (e) {
    errorText.value = e instanceof ApiError ? e.message : '登录失败'
  } finally {
    loading.value = false
  }
}

function fillDemo() {
  form.username = 'admin'
  form.password = 'admin123'
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-head">
        <h1 class="auth-title">FinLend 管理端</h1>
        <p class="auth-sub muted">管理员独立入口 · 公开用户登录不能签发管理权限</p>
      </div>

      <el-alert v-if="errorText" :title="errorText" type="error" show-icon :closable="false" class="auth-alert" />

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="管理员账号" prop="username">
          <el-input v-model="form.username" placeholder="请输入管理员账号" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" class="auth-submit" :loading="loading" @click="submit">登录管理端</el-button>
      </el-form>

      <div class="auth-links">
        <router-link to="/login">返回借款人端</router-link>
        <el-button text type="primary" size="small" @click="fillDemo">填入演示管理员</el-button>
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
  background: linear-gradient(160deg, #1f2328 0%, #2d333b 45%, #373e47 100%);
  padding: 24px;
}
.auth-card {
  width: 400px;
  max-width: 100%;
  background: #fff;
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
.auth-submit {
  width: 100%;
}
.auth-links {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  font-size: 13px;
}
</style>
