<script setup lang="ts">
import { onMounted, ref, watch, computed } from "vue";
import homeImg from "../assets/home.svg";
import petImg from "../assets/pet.svg";

interface Point {
    x: number;
    y: number;
}

interface Props {
    xMax: number;
    yMax: number;
    home: Point;
    shop: Point;
}

const props = withDefaults(defineProps<Props>(), {
    xMax: 6,
    yMax: 6,
    home: () => ({ x: 0, y: 0 }),
    shop: () => ({ x: 6, y: 6 })
});

const canvasRef = ref<HTMLCanvasElement>();
const homeImage = ref<HTMLImageElement>();
const petImage = ref<HTMLImageElement>();

const currentStep = ref(0);
const animProgress = ref(1.0);

const cellSize = 60;
const padding = 40;
const circleRadius = 15; // 固定圆的半径，用于计算箭头位置

// === 数学工具 ===
const factorial = (n: number): number => {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
};

const getCombinations = (x: number, y: number) => {
    const n = x + y;
    const k = x;
    return Math.round(factorial(n) / (factorial(k) * factorial(n - k)));
};

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// === 修复后的箭头绘制函数 ===
// 现在的逻辑：从圆的边缘连到另一个圆的边缘
function drawArrow(ctx: CanvasRenderingContext2D, startP: Point, endP: Point, progress: number, isUp: boolean) {
    const dx = endP.x - startP.x;
    const dy = endP.y - startP.y;

    // 计算总长度
    const fullDist = Math.sqrt(dx * dx + dy * dy);

    // 按照进度计算当前需要画多长
    const currentDist = fullDist * progress;
    if (currentDist <= 0) return;

    const angle = Math.atan2(dy, dx);

    // 计算当前画线的终点
    const currentEndX = startP.x + Math.cos(angle) * currentDist;
    const currentEndY = startP.y + Math.sin(angle) * currentDist;

    // 1. 画线身
    ctx.beginPath();
    ctx.moveTo(startP.x, startP.y);
    ctx.lineTo(currentEndX, currentEndY);
    ctx.lineWidth = 4; // 加粗一点，更明显
    ctx.strokeStyle = isUp ? "#a855f7" : "#f59e0b";
    ctx.lineCap = "round";
    ctx.stroke();

    // 2. 画箭头头 (只有当线条有一定长度时才画)
    if (currentDist > 5) {
        const headLen = 10;
        ctx.beginPath();
        // 箭头尖端就是当前线的终点
        ctx.moveTo(currentEndX, currentEndY);
        ctx.lineTo(currentEndX - headLen * Math.cos(angle - Math.PI / 6), currentEndY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(currentEndX, currentEndY);
        ctx.lineTo(currentEndX - headLen * Math.cos(angle + Math.PI / 6), currentEndY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
    }
}

function draw() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = padding * 2 + props.xMax * cellSize;
    const height = padding * 2 + props.yMax * cellSize;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    // === Layer 1: 网格和坐标 (最底层) ===
    drawGridAndLabels(ctx);

    // === Layer 2: 图片 ===
    drawImages(ctx);

    // === Layer 3: 旧的数字 (灰色) ===
    // 只要不是当前步数的，都算旧的
    for (let x = 0; x <= props.xMax; x++) {
        for (let y = 0; y <= props.yMax; y++) {
            const step = x + y;
            if (step < currentStep.value) { // 小于当前步数
                drawNumberCircle(ctx, x, y, false);
            }
        }
    }

    // === Layer 4: 当前这一步的新数字背景 (先画圆，再画箭头，最后写字) ===
    // 我们先把当前步数的圆画出来，这样箭头就能压在圆的边缘上，或者指向圆心
    // 用户的要求是：箭头在最上层。
    // 所以顺序是：旧数字 -> 新数字的圆背景 -> 箭头 -> 新数字的文字

    const newPoints: Point[] = [];
    for (let x = 0; x <= props.xMax; x++) {
        for (let y = 0; y <= props.yMax; y++) {
            if (x + y === currentStep.value) {
                newPoints.push({ x, y });
            }
        }
    }

    // 4.1 先画新数字的圆背景 (这样箭头可以盖住圆的一点边缘，显得连接紧密)
    for (const p of newPoints) {
        drawNumberCircleBackground(ctx, p.x, p.y, animProgress.value);
    }

    // 4.2 画箭头 (在圆背景之上！)
    if (animProgress.value > 0) {
        for (const p of newPoints) {
            const px = padding + p.x * cellSize;
            const py = padding + (props.yMax - p.y) * cellSize;

            // 从左边来: (x-1, y) -> (x, y)
            if (p.x > 0) {
                // 起点：左边格子的右边缘
                const startX = (padding + (p.x - 1) * cellSize) + circleRadius;
                const startY = py;
                // 终点：当前格子的左边缘
                const endX = px - circleRadius;
                const endY = py;

                drawArrow(ctx, { x: startX, y: startY }, { x: endX, y: endY }, animProgress.value, false);
            }

            // 从下边来: (x, y-1) -> (x, y)
            if (p.y > 0) {
                // 起点：下边格子的上边缘
                const startX = px;
                const startY = (padding + (props.yMax - (p.y - 1)) * cellSize) - circleRadius;
                // 终点：当前格子的下边缘
                const endX = px;
                const endY = py + circleRadius;

                drawArrow(ctx, { x: startX, y: startY }, { x: endX, y: endY }, animProgress.value, true);
            }
        }
    }

    // 4.3 最后画文字 (确保文字在最最上层，不被箭头挡住)
    for (const p of newPoints) {
        drawNumberText(ctx, p.x, p.y);
    }
}

// === 拆分出来的绘制子函数，保持逻辑清晰 ===

function drawGridAndLabels(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    // 纵线
    for (let x = 0; x <= props.xMax; x++) {
        const px = padding + x * cellSize;
        ctx.beginPath(); ctx.moveTo(px, padding); ctx.lineTo(px, padding + props.yMax * cellSize); ctx.stroke();
    }
    // 横线
    for (let y = 0; y <= props.yMax; y++) {
        const py = padding + (props.yMax - y) * cellSize;
        ctx.beginPath(); ctx.moveTo(padding, py); ctx.lineTo(padding + props.xMax * cellSize, py); ctx.stroke();
    }
    // 标签
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px sans-serif";
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

function drawImages(ctx: CanvasRenderingContext2D) {
    const iconSize = 32;
    if (homeImage.value) {
        const px = padding + props.home.x * cellSize - iconSize / 2;
        const py = padding + (props.yMax - props.home.y) * cellSize - iconSize / 2;
        ctx.drawImage(homeImage.value, px, py, iconSize, iconSize);
    }
    if (petImage.value) {
        const px = padding + props.shop.x * cellSize - iconSize / 2;
        const py = padding + (props.yMax - props.shop.y) * cellSize - iconSize / 2;
        ctx.drawImage(petImage.value, px, py, iconSize, iconSize);
    }
}

// 画完整的数字圆（用于旧数字）
function drawNumberCircle(ctx: CanvasRenderingContext2D, x: number, y: number, isNew: boolean) {
    const px = padding + x * cellSize;
    const py = padding + (props.yMax - y) * cellSize;
    const value = getCombinations(x, y);

    // 文字颜色：旧数字深灰
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#1e293b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value.toString(), px, py);
}

// 只画圆背景
function drawNumberCircleBackground(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number) {
    const px = padding + x * cellSize;
    const py = padding + (props.yMax - y) * cellSize;

    const alpha = Math.min(progress * 2, 1);
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.arc(px, py, circleRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#eff6ff"; // 浅蓝背景
    ctx.fill();
    ctx.strokeStyle = "#3b82f6"; // 蓝边框
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 1.0;
}

// 只画文字
function drawNumberText(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const px = padding + x * cellSize;
    const py = padding + (props.yMax - y) * cellSize;
    const value = getCombinations(x, y);

    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#2563eb"; // 亮蓝文字
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value.toString(), px, py);
}

// === 动画循环 ===
let animationFrameId: number;
const startAnimation = () => {
    const startTime = performance.now();
    const duration = 400;

    const animate = (time: number) => {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        animProgress.value = progress; // 简单线性即可，或者 easeOut
        draw();
        if (progress < 1) {
            animationFrameId = requestAnimationFrame(animate);
        }
    };
    animationFrameId = requestAnimationFrame(animate);
};

const maxPossibleSteps = computed(() => props.xMax + props.yMax);
const nextStep = () => {
    if (currentStep.value < maxPossibleSteps.value) {
        currentStep.value++;
        animProgress.value = 0;
        startAnimation();
    }
};
const prevStep = () => {
    if (currentStep.value > 0) {
        currentStep.value--;
        animProgress.value = 1;
        draw();
    }
};

onMounted(async () => {
    try {
        homeImage.value = await loadImage(homeImg);
        petImage.value = await loadImage(petImg);
        draw();
    } catch (e) { draw(); }
});

watch(() => [props.xMax, props.yMax], () => { currentStep.value = 0; draw(); });
</script>

<template>
    <p class="text-sm text-slate-500 mt-5">
        当前步数: <span class="text-blue-600 font-bold text-lg">{{ currentStep }}</span>
    </p>

    <div class="inline-block">
        <canvas ref="canvasRef" class="block" />
    </div>

    <p class="mt-2 text-xs text-slate-500 mb-2">
      按下按钮可以查看帕斯卡三角形的生成过程，因为每条路都是单行道所以只能上或右
    </p>
    <div class="flex gap-2">
        <button @click="prevStep" :disabled="currentStep <= 0" class="btn-primary">
            上一步
        </button>
        <button @click="nextStep" :disabled="currentStep >= maxPossibleSteps" class="btn-primary">
            下一步
        </button>
    </div>
</template>