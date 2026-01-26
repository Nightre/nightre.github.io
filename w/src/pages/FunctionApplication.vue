<template>
  <div class="p-4 w-full">
    <div class="flex items-center gap-2">
      <button class="btn btn-sm" @click="back">返回</button>
      <h2 class="text-lg font-bold">函数综合应用</h2>
    </div>

    <div class="mt-4 bg-base-100 rounded-box shadow-md p-4">
      <div class="text-sm opacity-70">错点</div>
      <div class="mt-1">综合应用</div>

      <div class="divider"></div>

      <div class="text-sm opacity-70">讲解</div>
      <div class="mt-2 whitespace-pre-line">把你的讲解内容写在这里。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const back = () => {
  router.push('/')
}
</script>
