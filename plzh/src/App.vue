<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import PageCover from "./pages/PageCover.vue";
import PageChapter1 from "./pages/PageChapter1.vue";
import PageChapter2 from "./pages/PageChapter2.vue";
import PageChapter3 from "./pages/PageChapter3.vue";
import PagePlaceholder from "./pages/PagePlaceholder.vue";

type Direction = "up" | "down";

const pages = [PageCover, PageChapter1, PageChapter2, PageChapter3];
const currentIndex = ref(0);
const direction = ref<Direction>("down");

const isAnimating = ref(false);
const animationMs = 650;

const viewportTransform = computed(() => {
  return `translate3d(0, ${-currentIndex.value * 100}vh, 0)`;
});

function clampIndex(next: number) {
  return Math.max(0, Math.min(pages.length - 1, next));
}

function goTo(nextIndex: number, dir: Direction) {
  const clamped = clampIndex(nextIndex);
  if (clamped === currentIndex.value) return;
  if (isAnimating.value) return;

  direction.value = dir;
  currentIndex.value = clamped;
  isAnimating.value = true;

  window.setTimeout(() => {
    isAnimating.value = false;
  }, animationMs);
}

function nextPage() {
  goTo(currentIndex.value + 1, "down");
}

function prevPage() {
  goTo(currentIndex.value - 1, "up");
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (isAnimating.value) return;

  const dy = e.deltaY;
  if (Math.abs(dy) < 5) return;
  if (dy > 0) nextPage();
  else prevPage();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
    e.preventDefault();
    nextPage();
    return;
  }
  if (e.key === "ArrowUp" || e.key === "PageUp") {
    e.preventDefault();
    prevPage();
    return;
  }
}

const touchStartY = ref<number | null>(null);
const touchDeltaY = ref(0);
const touchThreshold = 50;

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return;
  const t = e.touches.item(0);
  if (!t) return;
  touchStartY.value = t.clientY;
  touchDeltaY.value = 0;
}

function onTouchMove(e: TouchEvent) {
  if (touchStartY.value === null) return;
  const t = e.touches.item(0);
  if (!t) return;
  touchDeltaY.value = t.clientY - touchStartY.value;
  e.preventDefault();
}

function onTouchEnd() {
  if (touchStartY.value === null) return;

  const dy = touchDeltaY.value;
  touchStartY.value = null;
  touchDeltaY.value = 0;

  if (Math.abs(dy) < touchThreshold) return;
  if (dy < 0) nextPage();
  else prevPage();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

</script>

<template>
  <main
    class="h-screen w-screen overflow-hidden"
    @wheel="onWheel"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <div
      class="h-screen w-screen transition-transform ease-out"
      :style="{ transform: viewportTransform, transitionDuration: `${animationMs}ms` }"
    >
      <section
        v-for="(Page, i) in pages"
        :key="i"
        class="h-screen w-screen"
      >
        <div
          class="h-full w-full"
          :class="
            i === currentIndex
              ? direction === 'down'
                ? 'animate-page-in-down'
                : 'animate-page-in-up'
              : ''
          "
        >
          <component :is="Page" />
        </div>
      </section>
    </div>
  </main>
</template>

<style>
@keyframes pageInDown {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pageInUp {
  from {
    opacity: 0;
    transform: translateY(-18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-page-in-down {
  animation: pageInDown 520ms ease-out both;
}

.animate-page-in-up {
  animation: pageInUp 520ms ease-out both;
}
</style>