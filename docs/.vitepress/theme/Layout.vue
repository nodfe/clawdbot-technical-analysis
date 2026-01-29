<script setup>
import DefaultTheme from 'vitepress/theme'
import { useRouter, useRoute } from 'vitepress'
import { onMounted } from 'vue'

const { Layout } = DefaultTheme
const router = useRouter()
const route = useRoute()

onMounted(() => {
  // 仅在根路径下检测
  if (route.path === '/' || route.path === '/index.html') {
    // 检查是否在浏览器环境
    if (typeof navigator !== 'undefined') {
      const userLang = navigator.language || navigator.userLanguage
      // 如果是英语环境，且不在 /en/ 路径下，跳转到 /en/
      if (userLang.toLowerCase().startsWith('en') && !route.path.startsWith('/en/')) {
        router.go('/en/')
      }
    }
  }
})
</script>

<template>
  <Layout />
</template>
