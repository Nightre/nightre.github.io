<template>
  <div class="flex items-center gap-2">
    <button class="btn btn-sm" @click="back">返回</button>
    <h2 class="text-lg font-bold">不等式</h2>
  </div>

  <div class="mt-4 bg-base-100 rounded-box shadow-md p-4">
    <div class="text-sm opacity-70">错点</div>
    <div class="mt-1">二次项系数为0的分类讨论、恒成立判定、解集区间开闭。</div>

    <div class="divider"></div>

    <div class="text-sm opacity-70">讲解</div>
    <div class="mt-2 whitespace-pre-line">把你的讲解内容写在这里。</div>
  </div>

  <div class="mt-4 bg-base-100 rounded-box shadow-md p-4">
    <div class="text-sm opacity-70">图片</div>
    <div class="mt-3 space-y-4">
      <img src="/q/inequality/QQ_1768628413159.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628417108.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628422396.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628535899.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628544448.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628551348.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628570748.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628573436.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628577380.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628582596.png" class="w-full h-auto block" />
      <img src="/q/inequality/QQ_1768628585580.png" class="w-full h-auto block" />
      <iframe src="https://www.desmos.com/calculator/yiaen3uty1?embed" width="500" height="500" style="border: 1px solid #ccc" frameborder=0></iframe>
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
