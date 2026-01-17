<script setup lang="ts">
import { computed, ref } from "vue";
import CityMapCanvas from "../components/CityMapCanvas.vue";

const xMax = 5;
const yMax = 4;

const home = { x: 0, y: 0 };
const shop = { x: 5, y: 4 };

// 当前路径，最后一个点是"小人"的位置
const path = ref([{ x: home.x, y: home.y }]);

const person = computed(() => path.value[path.value.length - 1] ?? home);

function canMoveTo(x: number, y: number) {
  return x >= 0 && x <= xMax && y >= 0 && y <= yMax;
}

function moveRight() {
  const cur = person.value;
  const nx = cur.x + 1;
  const ny = cur.y;
  if (!canMoveTo(nx, ny)) return;
  path.value = [...path.value, { x: nx, y: ny }];
}

function moveUp() {
  const cur = person.value;
  const nx = cur.x;
  const ny = cur.y + 1;
  if (!canMoveTo(nx, ny)) return;
  path.value = [...path.value, { x: nx, y: ny }];
}

function reset() {
  path.value = [{ x: home.x, y: home.y }];
}
</script>

<template>
  <section class="h-full w-full p-6">
    <h1 class="text-lg font-bold text-slate-900">第一章</h1>
    <p class="mt-2 text-slate-700">
      假设你在一个城市的路口，你要从
      <span class="font-bold">家(0,0)</span>
      去
      <span class="font-bold">宠物店(5,4)</span>
      领养一些宠物，这个城市的所有路都是横平竖直的而且都是
      <span class="font-bold">单行道</span>
      ，我们建立一个坐标系，用两个整数表示每个路口
    </p>

    <div class="mt-4">
      <CityMapCanvas
        :x-max="xMax"
        :y-max="yMax"
        :home="home"
        :shop="shop"
        :path="path"
        :person="person"
        class="max-w-3xl"
      />
    </div>

    <p class="mt-2 text-xs text-slate-500 mb-2">
      按下按钮操控小人，因为每条路都是单行道所以只能上或右
    </p>
    <div class="flex items-center gap-2">
      <button class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm" @click="moveRight">→</button>
      <button class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm" @click="moveUp">↑</button>
      <button class="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm" @click="reset">重置</button>
    </div>
    <p class="mt-2 text-slate-700">当前路径有 {{ path.map(p => `(${p.x},${p.y})`).join(" -> ") }}</p>
    <p class="mt-5 text-slate-700">每一种不同的经过路口的次序都构成一个独特的路线。那么一共有多少种不同的路线呢？这是组合数学非常经典的一个问题</p>
  </section>
</template>