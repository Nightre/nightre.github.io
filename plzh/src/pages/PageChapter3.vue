<script setup lang="ts">
import PascalTransform from "../components/PascalTransform.vue";

const xMax = 5;
const yMax = 5;

const home = { x: 0, y: 0 };
const shop = { x: 5, y: 4 };
</script>

<template>
  <section class="h-full w-full p-6">
    <h1 class="text-lg font-bold text-slate-900">第二章 - 帕斯卡三角形</h1>
    
    <PascalTransform :x-max="xMax" :y-max="yMax" :home="home" :shop="shop" />
  </section>
</template>
