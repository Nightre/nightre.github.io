<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import homeImg from "../assets/home.svg";
import petImg from "../assets/pet.svg";
import humanImg from "../assets/human.svg";

interface Point {
  x: number;
  y: number;
}

interface Props {
  xMax: number;
  yMax: number;
  home: Point;
  shop: Point;
  path: Point[];
  person: Point;
}

const props = defineProps<Props>();

const canvasRef = ref<HTMLCanvasElement>();
const homeImage = ref<HTMLImageElement>();
const petImage = ref<HTMLImageElement>();
const humanImage = ref<HTMLImageElement>();

const cellSize = 60;
const padding = 30;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;

  // 绘制网格线
  for (let x = 0; x <= props.xMax; x++) {
    const px = padding + x * cellSize;
    ctx.beginPath();
    ctx.moveTo(px, padding);
    ctx.lineTo(px, padding + props.yMax * cellSize);
    ctx.stroke();
  }

  for (let y = 0; y <= props.yMax; y++) {
    const py = padding + (props.yMax - y) * cellSize;
    ctx.beginPath();
    ctx.moveTo(padding, py);
    ctx.lineTo(padding + props.xMax * cellSize, py);
    ctx.stroke();
  }

  // 绘制坐标标签
  ctx.fillStyle = "#475569";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let x = 0; x <= props.xMax; x++) {
    const px = padding + x * cellSize;
    ctx.fillText(x.toString(), px, padding + props.yMax * cellSize + 20);
  }

  for (let y = 0; y <= props.yMax; y++) {
    const py = padding + (props.yMax - y) * cellSize;
    ctx.fillText(y.toString(), padding - 20, py);
  }
}

function drawPath(ctx: CanvasRenderingContext2D) {
  if (props.path.length < 2) return;

  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 3;
  ctx.beginPath();

  for (let i = 0; i < props.path.length; i++) {
    const point = props.path[i];
    if (!point) continue;
    const px = padding + point.x * cellSize;
    const py = padding + (props.yMax - point.y) * cellSize;

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();

  // 绘制路径点
  ctx.fillStyle = "#3b82f6";
  for (const point of props.path) {
    const px = padding + point.x * cellSize;
    const py = padding + (props.yMax - point.y) * cellSize;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawImages(ctx: CanvasRenderingContext2D) {
  const iconSize = 32;

  // 绘制家
  if (homeImage.value) {
    const px = padding + props.home.x * cellSize - iconSize / 2;
    const py = padding + (props.yMax - props.home.y) * cellSize - iconSize / 2;
    ctx.drawImage(homeImage.value, px, py, iconSize, iconSize);
  }

  // 绘制宠物店
  if (petImage.value) {
    const px = padding + props.shop.x * cellSize - iconSize / 2;
    const py = padding + (props.yMax - props.shop.y) * cellSize - iconSize / 2;
    ctx.drawImage(petImage.value, px, py, iconSize, iconSize);
  }

  // 绘制人物
  if (humanImage.value) {
    const px = padding + props.person.x * cellSize - iconSize / 2;
    const py = padding + (props.yMax - props.person.y) * cellSize - iconSize / 2;
    ctx.drawImage(humanImage.value, px, py, iconSize, iconSize);
  }
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = padding * 2 + props.xMax * cellSize;
  const height = padding * 2 + props.yMax * cellSize;

  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height);
  drawPath(ctx);
  drawImages(ctx);
}

onMounted(async () => {
  try {
    homeImage.value = await loadImage(homeImg);
    petImage.value = await loadImage(petImg);
    humanImage.value = await loadImage(humanImg);
    draw();
  } catch (error) {
    console.error("Failed to load images:", error);
    draw(); // 即使图片加载失败也绘制网格
  }
});

watch(() => [props.path, props.person], draw, { deep: true });
</script>

<template>
  <div class="inline-block">
    <canvas
      ref="canvasRef"
    />
  </div>
</template>
