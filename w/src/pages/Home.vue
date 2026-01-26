<template>
  <h1 class="text-lg font-bold">给C+1的错题教程</h1>
  <p class="mt-2">你好啊，我看了你给我的错题集。我把错题按照知识点分为下面几类。我会根据你的错题来讲解知识点。</p>

  <ul class="mt-4 list bg-base-100 rounded-box shadow-md">
    <li class="p-4 pb-2 text-xs opacity-60 tracking-wide">按照错题知识点分类</li>

    <li class="list-row" v-for="knowledgePoint in knowledgePoints" :key="knowledgePoint.path">
      <div><img class="size-10 rounded-box" src="/kno.svg" /></div>
      <div>
        <div>{{ knowledgePoint.name }}</div>
      </div>
      <button class="btn btn-square btn-ghost" @click="go(knowledgePoint.path)">
        <svg class="size-[1.2em]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <g stroke-linejoin="round" stroke-linecap="round" stroke-width="2" fill="none" stroke="currentColor">
            <path d="M6 3L20 12 6 21 6 3z"></path>
          </g>
        </svg>
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const go = (path: string) => {
  router.push(path)
}

const knowledgePoints = [
  {
    name: '不等式',
    description: '二次项系数为0的分类讨论、恒成立判定、解集区间开闭。',
    path: '/inequality'
  },

  {
    name: '集合与常用逻辑',
    description: '空集可能性（临界值）、分式分母非零、真子集包含关系。',
    path: '/set-logic'
  },

  {
    name: '二次函数',
    description: '待定系数法求解析式、图象与系数关系、实际应用中的定义域限制。',
    path: '/quadratic-function'
  },
  {
    name: '数列',
    description: 'Sn转an时的n=1检验、等差/等比基本量运算、前n项和最值。',
    path: '/sequence'
  },
  {
    name: '三角函数',
    description: '解集的周期性(2kπ)、象限符号判定(口诀应用)、同角三角比转化。',
    path: '/trigonometric-function'
  },
  {
    name: '函数综合应用',
    description: '综合应用',
    path: '/function-application'
  }
]
</script>
