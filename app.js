import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  BOX_EDGES,
  buildBoxVertices,
  buildClipRows,
  buildProjectionFromConstruction,
  lineIntersection,
  projectPoint,
  recoverCamera,
} from "./cuboid-projector.js";

const DEFAULT_FBX_URL = "./Walking.fbx";
const SVG_NS = "http://www.w3.org/2000/svg";
const AXIS_STYLES = {
  x: { color: "#df3d4f", label: "X" },
  y: { color: "#2f9b68", label: "Y" },
  z: { color: "#3479c9", label: "Z" },
};
const PHASE_LABELS = [
  "按住并拖动，画第一条辅助线",
  "再画一条相交的辅助线",
  "在第一条辅助线上点第一条边的起点",
  "在第二条辅助线上点第一条边的终点",
  "在第一条辅助线上点第二条边的起点",
  "在第二条辅助线上点第二条边的终点",
  "点击垂直方向的灭点，也可以按住拖到画外",
  "透视盒已完成",
];

const imageInput = document.querySelector("#imageInput");
const fbxInput = document.querySelector("#fbxInput");
const undoButton = document.querySelector("#undoButton");
const resetButton = document.querySelector("#resetButton");
const flipXButton = document.querySelector("#flipXButton");
const flipYButton = document.querySelector("#flipYButton");
const flipZButton = document.querySelector("#flipZButton");
const modelInput = document.querySelector("#modelInput");
const playInput = document.querySelector("#playInput");
const downloadButton = document.querySelector("#downloadButton");
const opacityInput = document.querySelector("#opacityInput");
const opacityValue = document.querySelector("#opacityValue");
const emptyState = document.querySelector("#emptyState");
const viewport = document.querySelector("#viewport");
const referenceImage = document.querySelector("#referenceImage");
const threeCanvas = document.querySelector("#threeCanvas");
const boxOverlay = document.querySelector("#boxOverlay");
const mainStatus = document.querySelector("#mainStatus");
const dragStatus = document.querySelector("#dragStatus");
const imageName = document.querySelector("#imageName");
const fbxName = document.querySelector("#fbxName");
const modelStatus = document.querySelector("#modelStatus");
const ratioValues = [
  document.querySelector("#ratioX"),
  document.querySelector("#ratioY"),
  document.querySelector("#ratioZ"),
];
const ratioBars = [
  document.querySelector("#ratioBarX"),
  document.querySelector("#ratioBarY"),
  document.querySelector("#ratioBarZ"),
];
const cameraPosition = document.querySelector("#cameraPosition");
const cameraRight = document.querySelector("#cameraRight");
const cameraUp = document.querySelector("#cameraUp");
const cameraForward = document.querySelector("#cameraForward");
const cameraFov = document.querySelector("#cameraFov");

const construction = {
  guideLines: [],
  edgePoints: [],
  verticalVanishingPoint: null,
  cursor: null,
  draftLine: null,
  pointerId: null,
  verticalPointerId: null,
};

let imageWidth = 0;
let imageHeight = 0;
let currentImageName = "";
let currentFbxName = "Walking.fbx";
let uploadedFbxUrl = null;
let boxDimensions = [0.42, 1, 0.28];
let boxVertices = buildBoxVertices(boxDimensions);
let projection = null;
let projectionDetails = null;
let axisSigns = [1, 1, 1];
let fbxObject = null;
let mixer = null;
let animationAction = null;
let modelReady = false;
let loadGeneration = 0;

const scene = new THREE.Scene();
const renderCamera = new THREE.Camera();
const renderer = new THREE.WebGLRenderer({
  canvas: threeCanvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
const modelRoot = new THREE.Group();
const animationClock = new THREE.Clock();

renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(2, 4, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d7ff, 1.1);
fillLight.position.set(-4, 1, 3);
scene.add(fillLight);
modelRoot.visible = false;
scene.add(modelRoot);

window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
updateRatios();
updateInterface();
startRenderLoop();
loadFbx(DEFAULT_FBX_URL, "Walking.fbx");

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    mainStatus.textContent = "请选择图片文件。";
    return;
  }

  try {
    await loadReferenceImage(file);
    currentImageName = file.name;
    imageName.textContent = currentImageName;
    resetConstruction();
    mainStatus.textContent = "参考图片已载入。";
  } catch (error) {
    console.error(error);
    mainStatus.textContent = `图片读取失败：${error.message}`;
  }
});

fbxInput.addEventListener("change", async () => {
  const file = fbxInput.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".fbx")) {
    modelStatus.textContent = "请选择 .fbx 文件。";
    fbxInput.value = "";
    return;
  }

  if (uploadedFbxUrl) URL.revokeObjectURL(uploadedFbxUrl);
  uploadedFbxUrl = URL.createObjectURL(file);
  await loadFbx(uploadedFbxUrl, file.name);
});

undoButton.addEventListener("click", undoConstruction);
resetButton.addEventListener("click", resetConstruction);
modelInput.addEventListener("change", updatePlaybackState);
playInput.addEventListener("change", updatePlaybackState);

opacityInput.addEventListener("input", () => {
  opacityValue.textContent = `${opacityInput.value}%`;
  applyModelOpacity(Number(opacityInput.value) / 100);
});

flipXButton.addEventListener("click", () => flipAxis(0));
flipYButton.addEventListener("click", () => flipAxis(1));
flipZButton.addEventListener("click", () => flipAxis(2));
downloadButton.addEventListener("click", downloadConfiguration);

boxOverlay.addEventListener("pointerdown", (event) => {
  if (!imageWidth) return;
  const phase = getPhase();
  const point = eventToImagePoint(event, phase < 6);

  if (phase < 2) {
    construction.pointerId = event.pointerId;
    construction.draftLine = [point, point];
    boxOverlay.setPointerCapture(event.pointerId);
    drawOverlay();
    event.preventDefault();
    return;
  }

  if (phase < 6) {
    addEdgePoint(point);
    event.preventDefault();
    return;
  }

  if (phase === 6) {
    construction.verticalPointerId = event.pointerId;
    construction.cursor = eventToImagePoint(event, false);
    boxOverlay.setPointerCapture(event.pointerId);
    previewConstruction();
    event.preventDefault();
  }
});

boxOverlay.addEventListener("pointermove", (event) => {
  if (construction.pointerId === event.pointerId && construction.draftLine) {
    construction.draftLine[1] = eventToImagePoint(event, true);
    drawOverlay();
    return;
  }

  if (construction.verticalPointerId === event.pointerId || getPhase() === 6) {
    construction.cursor = eventToImagePoint(event, false);
    previewConstruction();
  }
});

boxOverlay.addEventListener("pointerup", finishPointerInteraction);
boxOverlay.addEventListener("pointercancel", cancelPointerInteraction);
boxOverlay.addEventListener("pointerleave", () => {
  if (getPhase() === 6 && construction.verticalPointerId === null) {
    construction.cursor = null;
    drawOverlay();
  }
});

window.addEventListener("resize", () => {
  resizeRenderer();
  drawOverlay();
});

if ("ResizeObserver" in window) {
  new ResizeObserver(drawOverlay).observe(viewport);
}

function finishPointerInteraction(event) {
  if (construction.pointerId === event.pointerId && construction.draftLine) {
    const line = construction.draftLine;
    construction.pointerId = null;
    construction.draftLine = null;
    if (distance(line[0], line[1]) >= displayScale(16)) {
      const nextLines = [...construction.guideLines, line];
      const canCreateVanishingPoint = nextLines.length < 2 || lineIntersection(
        toNormalizedLine(nextLines[0]),
        toNormalizedLine(nextLines[1]),
      );
      if (canCreateVanishingPoint) {
        construction.guideLines.push(line);
        mainStatus.textContent = construction.guideLines.length === 2
          ? "第一个灭点已由两条辅助线确定。"
          : "第一条辅助线已记录。";
      } else {
        mainStatus.textContent = "两条辅助线不能平行，请重新画第二条。";
      }
    } else {
      mainStatus.textContent = "辅助线太短，请重新画。";
    }
    releasePointer(event.pointerId);
    updateInterface();
    return;
  }

  if (construction.verticalPointerId === event.pointerId) {
    construction.verticalPointerId = null;
    releasePointer(event.pointerId);
    finalizeVerticalVanishingPoint();
  }
}

function cancelPointerInteraction(event) {
  if (construction.pointerId === event.pointerId) {
    construction.pointerId = null;
    construction.draftLine = null;
  }
  if (construction.verticalPointerId === event.pointerId) {
    construction.verticalPointerId = null;
  }
  releasePointer(event.pointerId);
  updateInterface();
}

function releasePointer(pointerId) {
  if (boxOverlay.hasPointerCapture(pointerId)) boxOverlay.releasePointerCapture(pointerId);
}

function addEdgePoint(pointerPoint) {
  const lineIndex = construction.edgePoints.length % 2;
  const snappedPoint = projectOntoLine(pointerPoint, construction.guideLines[lineIndex]);
  if (!isInsideFrame(snappedPoint)) {
    mainStatus.textContent = "请在线条位于画面内的部分选点。";
    return;
  }

  const nextEdgePoints = [...construction.edgePoints, snappedPoint];
  if (nextEdgePoints.length === 4) {
    const nextVanishing = lineIntersection(
      toNormalizedLine([nextEdgePoints[0], nextEdgePoints[1]]),
      toNormalizedLine([nextEdgePoints[2], nextEdgePoints[3]]),
    );
    if (!nextVanishing) {
      mainStatus.textContent = "两条边不能平行，请重新选择最后一个点。";
      return;
    }
  }

  construction.edgePoints.push(snappedPoint);
  if (construction.edgePoints.length === 2) {
    mainStatus.textContent = "第一条边已确定。";
  } else if (construction.edgePoints.length === 4) {
    const secondVanishing = lineIntersection(
      toNormalizedLine([construction.edgePoints[0], construction.edgePoints[1]]),
      toNormalizedLine([construction.edgePoints[2], construction.edgePoints[3]]),
    );
    mainStatus.textContent = secondVanishing
      ? "第二个灭点已确定，请设置垂直灭点。"
      : "两条边平行，无法得到第二个灭点，请撤销后重画。";
  }
  updateInterface();
}

function previewConstruction() {
  projectionDetails = buildFromCurrentConstruction(construction.cursor);
  drawOverlay(projectionDetails?.projection || null);
  if (!projectionDetails?.projection) {
    dragStatus.textContent = reasonText(projectionDetails?.reason);
  } else {
    dragStatus.textContent = "松开以确定垂直灭点";
  }
}

function finalizeVerticalVanishingPoint() {
  const result = buildFromCurrentConstruction(construction.cursor);
  if (!result?.projection) {
    mainStatus.textContent = reasonText(result?.reason);
    projectionDetails = null;
    updateInterface();
    return;
  }

  construction.verticalVanishingPoint = construction.cursor;
  construction.cursor = null;
  projectionDetails = result;
  projection = result.projection;
  mainStatus.textContent = "透视盒已按模型三边比例生成。";
  updateProjectionOutput();
  updateInterface();
}

function buildFromCurrentConstruction(verticalPoint = construction.verticalVanishingPoint) {
  if (!verticalPoint || construction.guideLines.length !== 2 || construction.edgePoints.length !== 4) {
    return { projection: null, reason: "incomplete" };
  }

  return buildProjectionFromConstruction({
    dimensions: boxDimensions,
    aspect: imageWidth / imageHeight,
    guideLines: construction.guideLines.map(toNormalizedLine),
    edgePoints: construction.edgePoints.map(toNormalizedPoint),
    verticalVanishingPoint: toNormalizedPoint(verticalPoint),
  });
}

function undoConstruction() {
  if (construction.verticalVanishingPoint) {
    construction.cursor = construction.verticalVanishingPoint;
    construction.verticalVanishingPoint = null;
  } else if (construction.edgePoints.length) {
    construction.edgePoints.pop();
  } else if (construction.guideLines.length) {
    construction.guideLines.pop();
  }

  clearProjection();
  mainStatus.textContent = "已撤销上一步。";
  updateInterface();
}

function resetConstruction() {
  construction.guideLines = [];
  construction.edgePoints = [];
  construction.verticalVanishingPoint = null;
  construction.cursor = null;
  construction.draftLine = null;
  construction.pointerId = null;
  construction.verticalPointerId = null;
  clearProjection();
  if (imageWidth) mainStatus.textContent = "从第一条辅助线开始。";
  updateInterface();
}

function clearProjection() {
  projection = null;
  projectionDetails = null;
  modelRoot.visible = false;
  updateCameraReadout();
}

function getPhase() {
  if (construction.guideLines.length < 2) return construction.guideLines.length;
  if (construction.edgePoints.length < 4) return 2 + construction.edgePoints.length;
  if (!construction.verticalVanishingPoint) return 6;
  return 7;
}

function updateInterface() {
  const phase = imageWidth ? getPhase() : 0;
  dragStatus.textContent = imageWidth ? PHASE_LABELS[phase] : "画第一条辅助线";
  const hasHistory = construction.guideLines.length
    || construction.edgePoints.length
    || construction.verticalVanishingPoint;
  undoButton.disabled = !hasHistory;
  resetButton.disabled = !imageWidth || !hasHistory;
  downloadButton.disabled = !projection;
  modelInput.disabled = !projection || !modelReady;
  playInput.disabled = !animationAction;
  for (const button of [flipXButton, flipYButton, flipZButton]) {
    button.disabled = !projection || !modelReady;
  }
  updatePlaybackState();
  drawOverlay();
}

async function loadReferenceImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      referenceImage.onload = resolve;
      referenceImage.onerror = () => reject(new Error("无法解码这张图片"));
      referenceImage.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  imageWidth = referenceImage.naturalWidth;
  imageHeight = referenceImage.naturalHeight;
  viewport.style.aspectRatio = `${imageWidth} / ${imageHeight}`;
  viewport.style.maxWidth = `${Math.max(36, 78 * (imageWidth / imageHeight))}vh`;
  viewport.style.display = "block";
  emptyState.style.display = "none";
  boxOverlay.setAttribute("viewBox", `0 0 ${imageWidth} ${imageHeight}`);
  resizeRenderer();
}

async function loadFbx(url, name) {
  const generation = ++loadGeneration;
  currentFbxName = name;
  fbxName.textContent = name;
  modelStatus.textContent = `正在读取 ${name} 的动画包围盒…`;
  modelReady = false;
  modelInput.disabled = true;
  playInput.disabled = true;
  disposeCurrentModel();

  try {
    const object = await new FBXLoader().loadAsync(url);
    if (generation !== loadGeneration) {
      disposeObject(object);
      return;
    }

    prepareModel(object);
    modelStatus.textContent = animationAction
      ? `${name} · 已按整段动画计算比例`
      : `${name} · 已按静态模型计算比例`;
    mainStatus.textContent = imageWidth
      ? "模型比例已更新。"
      : "模型已就绪，请选择参考图片。";
  } catch (error) {
    console.error(error);
    modelStatus.textContent = `FBX 读取失败：${error.message}`;
    mainStatus.textContent = "模型读取失败。";
  }
}

function prepareModel(object) {
  object.updateMatrixWorld(true);
  const [clip] = object.animations || [];
  const bounds = measureModelBounds(object, clip);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const largestSide = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largestSide) || largestSide <= 1e-6) {
    throw new Error("模型包围盒为空");
  }

  boxDimensions = [size.x / largestSide, size.y / largestSide, size.z / largestSide];
  boxVertices = buildBoxVertices(boxDimensions);

  object.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    const originals = Array.isArray(child.material) ? child.material : [child.material];
    const materials = originals.map((material) => {
      const clone = material?.clone?.() || new THREE.MeshStandardMaterial({ color: 0xbfc7d1 });
      clone.side = THREE.DoubleSide;
      return clone;
    });
    child.material = Array.isArray(child.material) ? materials : materials[0];
  });

  const offset = new THREE.Group();
  offset.position.set(-center.x, -center.y, -center.z);
  offset.add(object);

  const normalized = new THREE.Group();
  normalized.scale.setScalar(1 / largestSide);
  normalized.rotation.y = Math.PI;
  normalized.add(offset);
  modelRoot.add(normalized);

  fbxObject = object;
  if (clip) {
    mixer = new THREE.AnimationMixer(object);
    animationAction = mixer.clipAction(clip);
    animationAction.play();
    mixer.setTime(0);
  }

  modelReady = true;
  applyAxisSigns();
  applyModelOpacity(Number(opacityInput.value) / 100);
  updateRatios();
  if (construction.verticalVanishingPoint) {
    const result = buildFromCurrentConstruction();
    if (result.projection) {
      projectionDetails = result;
      projection = result.projection;
      updateProjectionOutput();
    } else {
      clearProjection();
    }
  }
  updateInterface();
}

function measureModelBounds(object, clip) {
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) {
    return new THREE.Box3().setFromObject(object, true);
  }

  const bounds = new THREE.Box3();
  const sampler = new THREE.AnimationMixer(object);
  const action = sampler.clipAction(clip);
  const sampleCount = Math.min(72, Math.max(12, Math.ceil(clip.duration * 12)));
  action.play();

  for (let index = 0; index <= sampleCount; index += 1) {
    sampler.setTime((clip.duration * index) / sampleCount);
    object.updateMatrixWorld(true);
    bounds.expandByObject(object, true);
  }

  sampler.stopAllAction();
  sampler.uncacheRoot(object);
  return bounds;
}

function disposeCurrentModel() {
  mixer?.stopAllAction();
  mixer = null;
  animationAction = null;
  fbxObject = null;
  for (const child of [...modelRoot.children]) {
    modelRoot.remove(child);
    disposeObject(child);
  }
}

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material)
      ? child.material
      : child.material ? [child.material] : [];
    for (const material of materials) material.dispose?.();
  });
}

function applyModelOpacity(opacity) {
  modelRoot.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = opacity < 0.999;
      material.opacity = opacity;
      material.depthWrite = opacity > 0.55;
      material.needsUpdate = true;
    }
  });
}

function flipAxis(axis) {
  axisSigns[axis] *= -1;
  applyAxisSigns();
}

function applyAxisSigns() {
  modelRoot.scale.set(axisSigns[0], axisSigns[1], axisSigns[2]);
  const buttons = [flipXButton, flipYButton, flipZButton];
  buttons.forEach((button, index) => {
    button.setAttribute("aria-pressed", axisSigns[index] < 0 ? "true" : "false");
  });
}

function updatePlaybackState() {
  modelRoot.visible = Boolean(modelInput.checked && modelReady && projection);
  if (!animationAction) return;
  animationAction.paused = !(playInput.checked && modelRoot.visible);
  animationClock.getDelta();
}

function updateProjectionOutput() {
  updateRenderCamera();
  updateCameraReadout();
  drawOverlay();
}

function updateRenderCamera() {
  if (!projection) return;
  const rows = buildClipRows(projection, boxVertices);
  if (!rows) return;
  renderCamera.projectionMatrix.set(...rows.flat());
  renderCamera.projectionMatrixInverse.copy(renderCamera.projectionMatrix).invert();
  renderCamera.matrixWorld.identity();
  renderCamera.matrixWorldInverse.identity();
}

function updateCameraReadout() {
  const result = projection ? recoverCamera(projection) : null;
  cameraPosition.textContent = formatVector(result?.position);
  cameraRight.textContent = formatVector(result?.right);
  cameraUp.textContent = formatVector(result?.up);
  cameraForward.textContent = formatVector(result?.forward);
  cameraFov.textContent = Number.isFinite(result?.verticalFov)
    ? `${result.verticalFov.toFixed(2)}°`
    : "--";
}

function updateRatios() {
  const maximum = Math.max(...boxDimensions);
  boxDimensions.forEach((value, index) => {
    ratioValues[index].textContent = value.toFixed(3);
    ratioBars[index].style.width = `${(value / maximum) * 100}%`;
  });
}

function drawOverlay(previewProjection = null) {
  boxOverlay.replaceChildren();
  if (!imageWidth) return;

  construction.guideLines.forEach((line, index) => {
    drawInfiniteLine(line, {
      stroke: "#73777d",
      opacity: construction.edgePoints.length % 2 === index && getPhase() >= 2 && getPhase() < 6 ? 0.9 : 0.55,
      width: 1.25,
      dash: true,
    });
  });

  if (construction.draftLine) {
    drawInfiniteLine(construction.draftLine, {
      stroke: "#555a61",
      opacity: 0.85,
      width: 1.5,
      dash: false,
    });
    drawSegment(construction.draftLine[0], construction.draftLine[1], "#555a61", 2);
  }

  if (construction.guideLines.length === 2) {
    const firstVanishing = lineIntersection(
      toNormalizedLine(construction.guideLines[0]),
      toNormalizedLine(construction.guideLines[1]),
    );
    if (firstVanishing) drawVanishingMarker(fromNormalizedPoint(firstVanishing), "X");
  }

  construction.edgePoints.forEach((point, index) => {
    drawPoint(point, index < 2 ? "#555a61" : "#70757a", 5.5);
  });

  if (construction.edgePoints.length >= 2) {
    drawInfiniteLine([construction.edgePoints[0], construction.edgePoints[1]], {
      stroke: "#8a8e94",
      opacity: 0.55,
      width: 1.1,
      dash: true,
    });
    drawSegment(construction.edgePoints[0], construction.edgePoints[1], "#62666c", 1.8);
  }
  if (construction.edgePoints.length >= 4) {
    drawInfiniteLine([construction.edgePoints[2], construction.edgePoints[3]], {
      stroke: "#8a8e94",
      opacity: 0.55,
      width: 1.1,
      dash: true,
    });
    drawSegment(construction.edgePoints[2], construction.edgePoints[3], "#62666c", 1.8);
    const secondVanishing = lineIntersection(
      toNormalizedLine([construction.edgePoints[0], construction.edgePoints[1]]),
      toNormalizedLine([construction.edgePoints[2], construction.edgePoints[3]]),
    );
    if (secondVanishing) drawVanishingMarker(fromNormalizedPoint(secondVanishing), "Y");
  }

  const verticalPoint = construction.verticalVanishingPoint || construction.cursor;
  if (verticalPoint && construction.edgePoints.length === 4) {
    for (const point of construction.edgePoints) {
      drawInfiniteLine([point, verticalPoint], {
        stroke: "#8d9197",
        opacity: 0.34,
        width: 1,
        dash: true,
      });
    }
    const verticalColor = construction.verticalVanishingPoint
      ? "#34373b"
      : previewProjection ? "#555a61" : "#a13a43";
    drawVanishingMarker(verticalPoint, "Z", verticalColor);
  }

  const activeProjection = projection || previewProjection;
  if (activeProjection) drawProjectedBox(activeProjection);
}

function drawProjectedBox(activeProjection) {
  const projected = boxVertices.map((vertex) => {
    const point = projectPoint(activeProjection, vertex);
    return fromNormalizedPoint(point);
  });

  for (const [axis, edges] of Object.entries(BOX_EDGES)) {
    for (const [from, to] of edges) {
      drawSegment(projected[from], projected[to], AXIS_STYLES[axis].color, 2.25);
    }
  }
}

function drawInfiniteLine(line, style) {
  const clipped = clipInfiniteLine(line[0], line[1]);
  if (!clipped) return;
  const element = createSvg("line", {
    x1: clipped[0].x,
    y1: clipped[0].y,
    x2: clipped[1].x,
    y2: clipped[1].y,
    stroke: style.stroke,
    "stroke-opacity": style.opacity,
    "stroke-width": displayScale(style.width),
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
  });
  if (style.dash) {
    element.setAttribute("stroke-dasharray", `${displayScale(6)} ${displayScale(5)}`);
  }
  boxOverlay.appendChild(element);
}

function drawSegment(from, to, color, width) {
  boxOverlay.appendChild(createSvg("line", {
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    stroke: color,
    "stroke-width": displayScale(width),
    "stroke-linecap": "round",
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
  }));
}

function drawPoint(point, color, radius) {
  boxOverlay.appendChild(createSvg("circle", {
    cx: point.x,
    cy: point.y,
    r: displayScale(radius),
    fill: "#fff",
    stroke: color,
    "stroke-width": displayScale(2),
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
  }));
}

function drawVanishingMarker(point, label, color = "#34373b") {
  const visible = isInsideFrame(point)
    ? point
    : firstFrameIntersection(point, { x: imageWidth / 2, y: imageHeight / 2 });
  if (!visible) return;
  const size = displayScale(6);
  boxOverlay.appendChild(createSvg("rect", {
    x: visible.x - size / 2,
    y: visible.y - size / 2,
    width: size,
    height: size,
    fill: "#fff",
    stroke: color,
    "stroke-width": displayScale(1.7),
    transform: `rotate(45 ${visible.x} ${visible.y})`,
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none",
  }));
  const text = createSvg("text", {
    x: Math.min(imageWidth - displayScale(14), Math.max(displayScale(8), visible.x + displayScale(8))),
    y: Math.min(imageHeight - displayScale(8), Math.max(displayScale(14), visible.y - displayScale(8))),
    fill: color,
    "font-size": displayScale(11),
    "font-family": "Inter, sans-serif",
    "font-weight": "700",
    "pointer-events": "none",
  });
  text.textContent = label;
  boxOverlay.appendChild(text);
}

function clipInfiniteLine(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-8) return null;
  const candidates = [];

  if (Math.abs(dx) > 1e-8) {
    for (const x of [0, imageWidth]) {
      const t = (x - from.x) / dx;
      const y = from.y + t * dy;
      if (y >= 0 && y <= imageHeight) candidates.push({ x, y });
    }
  }
  if (Math.abs(dy) > 1e-8) {
    for (const y of [0, imageHeight]) {
      const t = (y - from.y) / dy;
      const x = from.x + t * dx;
      if (x >= 0 && x <= imageWidth) candidates.push({ x, y });
    }
  }

  if (candidates.length < 2) return null;
  let best = [candidates[0], candidates[1]];
  let bestDistance = -1;
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const candidateDistance = distance(candidates[left], candidates[right]);
      if (candidateDistance > bestDistance) {
        bestDistance = candidateDistance;
        best = [candidates[left], candidates[right]];
      }
    }
  }
  return best;
}

function firstFrameIntersection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const candidates = [];
  const add = (t, x, y) => {
    if (t < 0 || t > 1) return;
    if (x < -1e-6 || x > imageWidth + 1e-6 || y < -1e-6 || y > imageHeight + 1e-6) return;
    candidates.push({
      x: Math.min(imageWidth, Math.max(0, x)),
      y: Math.min(imageHeight, Math.max(0, y)),
      t,
    });
  };

  if (Math.abs(dx) > 1e-8) {
    for (const x of [0, imageWidth]) {
      const t = (x - from.x) / dx;
      add(t, x, from.y + t * dy);
    }
  }
  if (Math.abs(dy) > 1e-8) {
    for (const y of [0, imageHeight]) {
      const t = (y - from.y) / dy;
      add(t, from.x + t * dx, y);
    }
  }
  candidates.sort((left, right) => left.t - right.t);
  return candidates[0] || null;
}

function projectOntoLine(point, line) {
  const dx = line[1].x - line[0].x;
  const dy = line[1].y - line[0].y;
  const denominator = dx * dx + dy * dy;
  if (denominator < 1e-8) return point;
  const t = ((point.x - line[0].x) * dx + (point.y - line[0].y) * dy) / denominator;
  return { x: line[0].x + t * dx, y: line[0].y + t * dy };
}

function createSvg(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function eventToImagePoint(event, clampToImage) {
  const bounds = boxOverlay.getBoundingClientRect();
  let x = ((event.clientX - bounds.left) / bounds.width) * imageWidth;
  let y = ((event.clientY - bounds.top) / bounds.height) * imageHeight;
  if (clampToImage) {
    x = Math.min(imageWidth, Math.max(0, x));
    y = Math.min(imageHeight, Math.max(0, y));
  }
  return { x, y };
}

function toNormalizedPoint(point) {
  return {
    x: (point.x / imageWidth) * 2 - 1,
    y: 1 - (point.y / imageHeight) * 2,
  };
}

function fromNormalizedPoint(point) {
  return {
    x: ((point.x + 1) * imageWidth) / 2,
    y: ((1 - point.y) * imageHeight) / 2,
  };
}

function toNormalizedLine(line) {
  return line.map(toNormalizedPoint);
}

function isInsideFrame(point) {
  return point.x >= 0 && point.x <= imageWidth && point.y >= 0 && point.y <= imageHeight;
}

function displayScale(cssPixels) {
  const width = viewport.getBoundingClientRect().width;
  return width > 0 ? cssPixels * (imageWidth / width) : cssPixels;
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function resizeRenderer() {
  if (!imageWidth || !imageHeight) return;
  const maximumSide = 1600;
  const scale = Math.min(1, maximumSide / Math.max(imageWidth, imageHeight));
  renderer.setSize(
    Math.max(1, Math.round(imageWidth * scale)),
    Math.max(1, Math.round(imageHeight * scale)),
    false,
  );
}

function startRenderLoop() {
  const tick = () => {
    requestAnimationFrame(tick);
    const delta = Math.min(animationClock.getDelta(), 0.1);
    if (mixer && animationAction && !animationAction.paused) mixer.update(delta);
    if (projection && imageWidth) renderer.render(scene, renderCamera);
  };
  tick();
}

function downloadConfiguration() {
  if (!projection) return;
  const camera = recoverCamera(projection);
  const payload = {
    version: 2,
    image: { name: currentImageName, width: imageWidth, height: imageHeight },
    fbx: {
      name: currentFbxName,
      default: currentFbxName === "Walking.fbx" && !uploadedFbxUrl,
    },
    box: {
      dimensions: boxDimensions.map(roundNumber),
      axisSigns,
    },
    construction: {
      guideLines: construction.guideLines.map((line) => line.map(normalizeSavedPoint)),
      edgePoints: construction.edgePoints.map(normalizeSavedPoint),
      verticalVanishingPoint: normalizeSavedPoint(construction.verticalVanishingPoint),
      vanishingPoints: projectionDetails?.vanishingPoints?.map((point) => ({
        x: roundNumber(point.x),
        y: roundNumber(point.y),
      })) || null,
    },
    projectionMatrix3x4: projection.map((row) => row.map(roundNumber)),
    camera: camera ? {
      position: camera.position.map(roundNumber),
      right: camera.right.map(roundNumber),
      up: camera.up.map(roundNumber),
      forward: camera.forward.map(roundNumber),
      verticalFovDegrees: roundNumber(camera.verticalFov),
    } : null,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName(currentImageName || "perspective-box")}-box.json`;
  link.click();
  URL.revokeObjectURL(url);
  mainStatus.textContent = "盒子配置已保存。";
}

function normalizeSavedPoint(point) {
  return point ? {
    x: roundNumber(point.x / imageWidth),
    y: roundNumber(point.y / imageHeight),
  } : null;
}

function reasonText(reason) {
  const messages = {
    incomplete: "请先完成前面的绘制步骤",
    "parallel-lines": "两组线不能平行，请调整绘制",
    "invalid-vanishing-points": "这个垂直灭点无法形成真实透视",
    "implausible-camera": "这个灭点产生的透视过强，请换一个位置",
    "invalid-face": "当前四个点无法组成透视面",
    "invalid-proportions": "两条边与模型比例相差过大，请撤销后重画",
    "invalid-axes": "三个方向过于接近，请调整灭点",
    "invalid-camera-position": "这个灭点会让视点落入盒子",
    "extreme-perspective": "这个灭点产生的前后倍率过大，请换一个位置",
  };
  return messages[reason] || "当前位置不符合透视限制";
}

function formatVector(vector) {
  return vector?.every(Number.isFinite)
    ? vector.map((value) => value.toFixed(4)).join(", ")
    : "--";
}

function roundNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(8)) : null;
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, "") || "perspective-box";
}
