<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import homeImg from "../assets/home.svg";
import petImg from "../assets/pet.svg";

interface Props {
  xMax?: number;
  yMax?: number;
}

const props = withDefaults(defineProps<Props>(), {
  xMax: 6,
  yMax: 6,
});

const canvasRef = ref<HTMLCanvasElement>();
const homeImage = ref<HTMLImageElement>();
const petImage = ref<HTMLImageElement>();
const isRotated = ref(false);

const cellSize = 60;
const padding = 40;

// === 数学工具 ===
const factorial = (n: number) => {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
};
const getCombinations = (x: number, y: number) => {
  const n = x + y;
  const k = x;
  return Math.round(factorial(n) / (factorial(k) * factorial(n - k)));
};

// === 生成数字数据 ===
const numbers = computed(() => {
  const list = [];
  for (let x = 0; x <= props.xMax; x++) {
    for (let y = 0; y <= props.yMax; y++) {
      list.push({
        x,
        y,
        value: getCombinations(x, y),
        // 计算 CSS left/top: (0,0) 在左下角
        left: padding + x * cellSize,
        top: padding + (props.yMax - y) * cellSize
      });
    }
  }
  return list;
});

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = padding * 2 + props.xMax * cellSize;
  const height = padding * 2 + props.yMax * cellSize;
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  // 1. 画网格
  ctx.strokeStyle = "#e2e8f0"; // 更淡一点的网格，不抢眼
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= props.xMax; x++) {
    const px = padding + x * cellSize;
    ctx.moveTo(px, padding); ctx.lineTo(px, padding + props.yMax * cellSize);
  }
  for (let y = 0; y <= props.yMax; y++) {
    const py = padding + (props.yMax - y) * cellSize;
    ctx.moveTo(padding, py); ctx.lineTo(padding + props.xMax * cellSize, py);
  }
  ctx.stroke();

  // 2. 画坐标标签
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let x = 0; x <= props.xMax; x++) {
    ctx.fillText(x.toString(), padding + x * cellSize, padding + props.yMax * cellSize + 20);
  }
  for (let y = 0; y <= props.yMax; y++) {
    const py = padding + (props.yMax - y) * cellSize;
    ctx.fillText(y.toString(), padding - 20, py);
  }

  // 3. 画图标
  const iconSize = 32;
  if (homeImage.value) {
    const px = padding + 0 * cellSize - iconSize/2;
    const py = padding + (props.yMax - 0) * cellSize - iconSize/2;
    ctx.drawImage(homeImage.value, px, py, iconSize, iconSize);
  }
  if (petImage.value) {
    const px = padding + props.xMax * cellSize - iconSize/2;
    const py = padding + (props.yMax - props.yMax) * cellSize - iconSize/2;
    ctx.drawImage(petImage.value, px, py, iconSize, iconSize);
  }
}

onMounted(async () => {
  homeImage.value = await loadImage(homeImg);
  petImage.value = await loadImage(petImg);
  draw();
});
watch(() => [props.xMax, props.yMax], draw);

const containerStyle = computed(() => ({
  width: `${padding * 2 + props.xMax * cellSize}px`,
  height: `${padding * 2 + props.yMax * cellSize}px`
}));
</script>

<template>
  <div class="flex flex-col items-center gap-12 py-10 w-full overflow-visible">
    
    <div class="relative transition-all duration-[1000ms] ease-in-out origin-center"
         :style="containerStyle"
         :class="isRotated ? 'rotate-[135deg]' : 'rotate-0'">
      
      <div class="absolute inset-0 m-[40px] bg-yellow-300/60 transition-opacity duration-700 z-0 rounded-sm"
           style="clip-path: polygon(0% 0%, 0% 100%, 100% 100%)"
           :class="isRotated ? 'opacity-100' : 'opacity-0'">
      </div>

      <canvas ref="canvasRef" class="absolute inset-0 z-10 pointer-events-none" />

      <div class="absolute inset-0 z-20 pointer-events-none">
        <div v-for="n in numbers" :key="`${n.x}-${n.y}`"
             class="absolute flex items-center justify-center w-8 h-8 -ml-4 -mt-4 text-slate-800 font-bold transition-transform duration-[1000ms]"
             :style="{ 
               left: `${n.left}px`, 
               top: `${n.top}px`, 
               transform: isRotated ? 'rotate(-135deg)' : 'rotate(0deg)' 
             }">
          {{ n.value }}
        </div>
      </div>

    </div>

    <button 
      @click="isRotated = !isRotated"
      class="px-8 py-3 bg-slate-800 text-white rounded-full shadow-lg hover:bg-slate-700 transition-all font-bold z-30"
    >
      {{ isRotated ? "还原直角坐标" : "旋转为杨辉三角" }}
    </button>

  </div>
</template>