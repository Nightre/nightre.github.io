<template>
  <div class="p-4 w-full">
    <div class="flex items-center gap-2">
      <button class="btn btn-sm" @click="emit('back')">返回</button>
      <h2 class="text-lg font-bold">{{ point.name }}</h2>
    </div>

    <div class="mt-4 bg-base-100 rounded-box shadow-md p-4">
      <div class="text-sm opacity-70">错点</div>
      <div class="mt-1">{{ point.description }}</div>

      <div class="divider"></div>

      <div class="text-sm opacity-70">讲解</div>
      <div class="mt-2 whitespace-pre-line">{{ explanation }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
type KnowledgePoint = {
  name: string
  description: string
}

const props = defineProps<{
  point: KnowledgePoint
}>()

const emit = defineEmits<{
  (e: 'back'): void
}>()

const explanation = `这里是「${props.point.name}」的讲解页面。

你可以把：
1) 核心概念
2) 常见坑点
3) 典型例题步骤
4) 你这份错题里对应的“错误原因”

逐条写在这里。`
</script>
