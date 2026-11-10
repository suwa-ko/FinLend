<script setup>
defineProps({
  title: { type: String, default: '加载失败' },
  message: { type: String, default: '请稍后重试' },
  retryText: { type: String, default: '重新加载' }
})
defineEmits(['retry'])
</script>

<template>
  <el-result icon="error" :title="title" :sub-title="message">
    <template #extra>
      <el-button type="primary" @click="$emit('retry')">{{ retryText }}</el-button>
    </template>
  </el-result>
</template>
