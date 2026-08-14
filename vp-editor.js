import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GifEncoder } from "./gif-encoder.js";
import {
  buildBoxVertices,
  buildClipRows,
  projectPoint,
} from "./cuboid-projector.js";

const DEFAULT_FBX_URL = "./Walking.fbx";
const SVG_NS = "http://www.w3.org/2000/svg";
const OVERLAY_STROKE_WIDTH = 2;
const GIF_TARGET_FPS = 15;
const GIF_MAX_FRAMES = 180;
const GIF_MAXIMUM_SIDE = 720;
const GIF_PIXEL_BUDGET = 36_000_000;
const AXES = [
  { id: "x", label: "X", color: "#df3d4f", index: 0 },
  { id: "y", label: "Y", color: "#2f9b68", index: 1 },
  { id: "z", label: "Z", color: "#3479c9", index: 2 },
];
const POINT_ORDER = [
  { axis: "x", label: "X", color: "#df3d4f" },
  { axis: "z", label: "Z", color: "#3479c9" },
  { axis: "y", label: "Y", color: "#2f9b68" },
];

const imageInput = document.querySelector("#imageInput");
const fbxInput = document.querySelector("#fbxInput");
const resetButton = document.querySelector("#resetButton");
const viewOrthoInput = document.querySelector("#viewOrthoInput");
const viewPerspectiveInput = document.querySelector("#viewPerspectiveInput");
const flipXButton = document.querySelector("#flipXButton");
const flipYButton = document.querySelector("#flipYButton");
const flipZButton = document.querySelector("#flipZButton");
const modelInput = document.querySelector("#modelInput");
const playInput = document.querySelector("#playInput");
const opacityInput = document.querySelector("#opacityInput");
const opacityValue = document.querySelector("#opacityValue");
const scaleInput = document.querySelector("#scaleInput");
const scaleValue = document.querySelector("#scaleValue");
const exportGifButton = document.querySelector("#exportGifButton");
const exportStatus = document.querySelector("#exportStatus");
const emptyState = document.querySelector("#emptyState");
const stage = document.querySelector("#stage");
const viewport = document.querySelector("#viewport");
const referenceImage = document.querySelector("#referenceImage");
const threeCanvas = document.querySelector("#threeCanvas");
const overlay = document.querySelector("#boxOverlay");
const mainStatus = document.querySelector("#mainStatus");
const dragStatus = document.querySelector("#dragStatus");
const imageName = document.querySelector("#imageName");
const fbxName = document.querySelector("#fbxName");
const modelStatus = document.querySelector("#modelStatus");

let imageWidth = 0;
let imageHeight = 0;
let uploadedFbxUrl = null;
let vanishingPoints = [];
let finalized = false;
let projection = null;
let perspectiveProjection = null;
let viewMode = "orthographic";
let orthoBasis = createDefaultOrthoBasis();
let orthoPan = [0, 0];
let modelTranslation = [0, 0, 0];
let modelDisplayScale = 1;
let axisSigns = [1, 1, 1];
let boxDimensions = [0.42, 1, 0.28];
let boxVertices = buildBoxVertices(boxDimensions);
let activeAssistantDrag = null;
let selectedAssistantIndex = -1;
let activeOrthoPan = null;
let activeAxisDrag = null;
let gizmoAxes = [];
let fbxObject = null;
let mixer = null;
let animationAction = null;
let modelReady = false;
let loadGeneration = 0;
let exportingGif = false;

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

updateInterface();
startRenderLoop();
loadFbx(DEFAULT_FBX_URL, "Walking.fbx");

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    mainStatus.textContent = "Please choose an image file.";
    return;
  }

  try {
    await loadReferenceImage(file);
    imageName.textContent = file.name;
    resetEditor();
    mainStatus.textContent = "Reference image loaded.";
  } catch (error) {
    console.error(error);
    mainStatus.textContent = `Image load failed: ${error.message}`;
  }
});

fbxInput.addEventListener("change", async () => {
  const file = fbxInput.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".fbx")) {
    modelStatus.textContent = "Please choose a .fbx file.";
    fbxInput.value = "";
    return;
  }

  if (uploadedFbxUrl) URL.revokeObjectURL(uploadedFbxUrl);
  uploadedFbxUrl = URL.createObjectURL(file);
  await loadFbx(uploadedFbxUrl, file.name);
});

emptyState.addEventListener("click", () => imageInput.click());
resetButton.addEventListener("click", resetEditor);
viewOrthoInput.addEventListener("change", () => {
  if (viewOrthoInput.checked) setViewMode("orthographic");
});
viewPerspectiveInput.addEventListener("change", () => {
  if (viewPerspectiveInput.checked) setViewMode("perspective");
});
modelInput.addEventListener("change", updatePlaybackState);
playInput.addEventListener("change", updatePlaybackState);
exportGifButton.addEventListener("click", exportGif);
window.addEventListener("keydown", handleKeyboardShortcut);

opacityInput.addEventListener("input", () => {
  opacityValue.textContent = `${opacityInput.value}%`;
  applyModelOpacity(Number(opacityInput.value) / 100);
});

scaleInput.addEventListener("input", () => {
  modelDisplayScale = Number(scaleInput.value) / 100;
  scaleValue.textContent = `${scaleInput.value}%`;
  applyModelTransform();
  updateRenderCamera();
  drawOverlay();
});

flipXButton.addEventListener("click", () => flipAxis(0));
flipYButton.addEventListener("click", () => flipAxis(1));
flipZButton.addEventListener("click", () => flipAxis(2));

overlay.addEventListener("pointerdown", (event) => {
  const edgeControl = event.target.closest("[data-ortho-edge]");
  if (edgeControl && viewMode === "orthographic" && projection) {
    rotateOrthographicView(edgeControl.dataset.orthoEdge);
    event.preventDefault();
    return;
  }

  const orthoPanHandle = event.target.closest("[data-ortho-pan]");
  if (orthoPanHandle && viewMode === "orthographic" && projection) {
    beginOrthoPan(event);
    event.preventDefault();
    return;
  }

  if (viewMode === "orthographic" && projection) {
    beginOrthoPan(event);
    event.preventDefault();
    return;
  }

  const assistantHandle = event.target.closest("[data-vp-handle]");
  if (assistantHandle) {
    beginAssistantDrag(event, assistantHandle);
    event.preventDefault();
    return;
  }

  const axisElement = event.target.closest("[data-gizmo-axis]");
  if (axisElement && finalized && projection) {
    beginAxisDrag(event, Number(axisElement.dataset.gizmoAxis));
    event.preventDefault();
    return;
  }

  if (!finalized && vanishingPoints.length < 3) {
    recordVanishingPoint(eventToImagePoint(event));
    event.preventDefault();
  }
});

overlay.addEventListener("pointermove", (event) => {
  if (activeOrthoPan?.pointerId === event.pointerId) {
    moveOrthoPan(event);
    return;
  }
  if (activeAssistantDrag?.pointerId === event.pointerId) {
    moveAssistantHandle(event);
    return;
  }
  if (activeAxisDrag?.pointerId === event.pointerId) {
    moveAlongAxis(event);
  }
});

overlay.addEventListener("pointerup", finishPointerAction);
overlay.addEventListener("pointercancel", cancelPointerAction);

function handleKeyboardShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() !== "z") return;
  const tagName = event.target?.tagName?.toLowerCase();
  if (["input", "textarea", "select"].includes(tagName) || event.target?.isContentEditable) return;
  if (!canUndoLastAction()) return;
  event.preventDefault();
  undoLastAction();
}

function canUndoLastAction() {
  return finalized || vanishingPoints.length > 0;
}

window.addEventListener("resize", () => {
  resizeRenderer();
  refreshOverlayGeometry();
});

if ("ResizeObserver" in window) {
  const overlayObserver = new ResizeObserver(refreshOverlayGeometry);
  overlayObserver.observe(stage);
  overlayObserver.observe(viewport);
}

function finishPointerAction(event) {
  if (activeOrthoPan?.pointerId === event.pointerId) {
    activeOrthoPan = null;
    releasePointer(event.pointerId);
    dragStatus.textContent = "Drag the center handle to pan in 2D";
    return;
  }

  if (activeAssistantDrag?.pointerId === event.pointerId) {
    activeAssistantDrag = null;
    releasePointer(event.pointerId);
    dragStatus.textContent = finalized
      ? "Drag a vanishing point helper or an axis arrow"
      : "Drag the five handles to tune the vanishing guides";
    drawOverlay();
    return;
  }

  if (activeAxisDrag?.pointerId === event.pointerId) {
    activeAxisDrag = null;
    releasePointer(event.pointerId);
    dragStatus.textContent = "Drag a vanishing point helper or an axis arrow";
    return;
  }

}

function recordVanishingPoint(point) {
  vanishingPoints.push(createVanishingAssistant(point, vanishingPoints.length));
  const pointCount = vanishingPoints.length;
  selectedAssistantIndex = pointCount - 1;
  mainStatus.textContent = `${POINT_ORDER[pointCount - 1].label} vanishing point recorded.`;
  if (pointCount === 3) finalizeVanishingPoints();
  else updateInterface();
}

function cancelPointerAction(event) {
  if (activeOrthoPan?.pointerId === event.pointerId) {
    orthoPan = activeOrthoPan.startPan;
    activeOrthoPan = null;
    refreshOrthographicProjection();
  }
  if (activeAssistantDrag?.pointerId === event.pointerId) {
    vanishingPoints[activeAssistantDrag.assistantIndex] = activeAssistantDrag.snapshot;
    activeAssistantDrag = null;
    rebuildProjectionFromAssistants();
  }
  if (activeAxisDrag?.pointerId === event.pointerId) activeAxisDrag = null;
  releasePointer(event.pointerId);
  updateInterface();
}

function releasePointer(pointerId) {
  if (overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
}

function finalizeVanishingPoints() {
  if (vanishingPoints.length < 3) return;
  finalized = true;
  viewMode = "perspective";
  orthoBasis = createDefaultOrthoBasis();
  orthoPan = [0, 0];
  modelTranslation = [0, 0, 0];
  perspectiveProjection = buildVanishingProjection();
  projection = perspectiveProjection;
  modelInput.checked = true;
  mainStatus.textContent = "Three vanishing points are set. Move the model along the axes.";
  updateRenderCamera();
  applyModelTransform();
  updateInterface();
}

function buildVanishingProjection() {
  const center = { x: 0, y: 0 };
  const normalizedPoints = vanishingPoints.map((assistant) => toNormalizedPoint(assistant.center));
  const pointsByAxis = [
    normalizedPoints[0],
    normalizedPoints[2],
    normalizedPoints[1],
  ];
  const desiredExtents = [0.58, 0.98, 0.42];
  const fallbackDirections = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 0.7, y: -0.7 },
  ];

  const columns = pointsByAxis.map((point, axisIndex) => {
    const localScale = desiredExtents[axisIndex] / Math.max(boxDimensions[axisIndex], 0.05);
    if (!point) return [0, localScale, 0];

    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-5) {
      const fallback = fallbackDirections[axisIndex];
      return [fallback.x * localScale, fallback.y * localScale, 0];
    }

    const denominatorChange = localScale / Math.max(distance, 0.18);
    return [
      point.x * denominatorChange,
      point.y * denominatorChange,
      denominatorChange,
    ];
  });

  const depthVariation = columns.reduce(
    (sum, column, index) => sum + Math.abs(column[2]) * boxDimensions[index] / 2,
    0,
  );
  const stabilityScale = depthVariation > 0.68 ? 0.68 / depthVariation : 1;
  for (const column of columns) {
    for (let index = 0; index < column.length; index += 1) column[index] *= stabilityScale;
  }

  return [
    [columns[0][0], columns[1][0], columns[2][0], center.x],
    [columns[0][1], columns[1][1], columns[2][1], center.y],
    [columns[0][2], columns[1][2], columns[2][2], 1],
  ];
}

function createDefaultOrthoBasis() {
  return {
    right: [1, 0, 0],
    up: [0, 1, 0],
    depth: [0, 0, 1],
  };
}

function setViewMode(mode) {
  if (!imageWidth || mode === viewMode) return;
  resetModelPosition();
  if (mode === "orthographic") {
    viewMode = "orthographic";
    projection = buildOrthographicProjection();
    updateRenderCamera();
    mainStatus.textContent = "Switched to orthographic view.";
  } else {
    viewMode = "perspective";
    projection = finalized ? perspectiveProjection : null;
    updateRenderCamera();
    mainStatus.textContent = finalized
      ? "Switched to three-point perspective view."
      : "Click the X vanishing point.";
  }
  updateInterface();
}

function rotateOrthographicView(edge) {
  if (!imageWidth) return;
  if (viewMode !== "orthographic") {
    viewMode = "orthographic";
  }

  const { right, up, depth } = orthoBasis;
  if (edge === "left") {
    orthoBasis = { right: [...depth], up: [...up], depth: negateVector(right) };
  } else if (edge === "right") {
    orthoBasis = { right: negateVector(depth), up: [...up], depth: [...right] };
  } else if (edge === "top") {
    orthoBasis = { right: [...right], up: negateVector(depth), depth: [...up] };
  } else if (edge === "bottom") {
    orthoBasis = { right: [...right], up: [...depth], depth: negateVector(up) };
  }

  refreshOrthographicProjection();
  mainStatus.textContent = "Rotated 90 degrees and switched to orthographic view.";
  updateInterface();
}

function buildOrthographicProjection() {
  const aspect = imageWidth / imageHeight;
  const horizontalHalf = Math.max(
    ...boxVertices.map((vertex) => Math.abs(dot3(orthoBasis.right, vertex))),
    0.05,
  );
  const verticalHalf = Math.max(
    ...boxVertices.map((vertex) => Math.abs(dot3(orthoBasis.up, vertex))),
    0.05,
  );
  const fit = 0.72;
  const scale = Math.min(
    (fit * aspect) / horizontalHalf,
    fit / verticalHalf,
  );
  const horizontal = orthoBasis.right.map((value) => (value * scale) / aspect);
  const vertical = orthoBasis.up.map((value) => value * scale);

  return [
    [...horizontal, orthoPan[0] - dot3(horizontal, modelTranslation)],
    [...vertical, orthoPan[1] - dot3(vertical, modelTranslation)],
    [0, 0, 0, 1],
  ];
}

function refreshOrthographicProjection() {
  if (viewMode !== "orthographic") return;
  projection = buildOrthographicProjection();
  updateRenderCamera();
  drawOverlay();
}

function beginOrthoPan(event) {
  activeOrthoPan = {
    pointerId: event.pointerId,
    startPointer: eventToImagePoint(event),
    startPan: [...orthoPan],
  };
  overlay.setPointerCapture(event.pointerId);
  dragStatus.textContent = "Panning the model in 2D";
}

function moveOrthoPan(event) {
  const point = eventToImagePoint(event);
  orthoPan = [
    activeOrthoPan.startPan[0]
      + ((point.x - activeOrthoPan.startPointer.x) * 2) / imageWidth,
    activeOrthoPan.startPan[1]
      - ((point.y - activeOrthoPan.startPointer.y) * 2) / imageHeight,
  ];
  refreshOrthographicProjection();
}

function dot3(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function negateVector(vector) {
  return vector.map((value) => -value);
}

function createVanishingAssistant(center, index) {
  const imageCenter = { x: imageWidth / 2, y: imageHeight / 2 };
  const towardCanvas = Math.atan2(imageCenter.y - center.y, imageCenter.x - center.x);
  const fallbackAngle = [-0.42, 2.72, 1.18][index] ?? -0.42;
  const baseAngle = distanceBetween(center, imageCenter) > displayScale(90)
    ? towardCanvas
    : fallbackAngle;
  const nearDistance = displayScale(48);
  const farDistance = displayScale(132);
  const angleOffsets = [-0.23, 0.23];

  return {
    center: { ...center },
    rays: angleOffsets.map((offset) => {
      const direction = {
        x: Math.cos(baseAngle + offset),
        y: Math.sin(baseAngle + offset),
      };
      return {
        near: addScaled(center, direction, nearDistance),
        far: addScaled(center, direction, farDistance),
      };
    }),
  };
}

function beginAssistantDrag(event, element) {
  const assistantIndex = Number(element.dataset.vpIndex);
  const assistant = vanishingPoints[assistantIndex];
  if (!assistant) return;

  selectedAssistantIndex = assistantIndex;
  activeAssistantDrag = {
    pointerId: event.pointerId,
    assistantIndex,
    handle: element.dataset.vpHandle,
    rayIndex: Number(element.dataset.rayIndex ?? -1),
    startPointer: eventToImagePoint(event),
    snapshot: cloneAssistant(assistant),
  };
  overlay.setPointerCapture(event.pointerId);
  dragStatus.textContent = activeAssistantDrag.handle === "center"
    ? "Moving the vanishing point helper"
    : activeAssistantDrag.handle === "near"
      ? "Adjusting the guide direction"
      : "Solving the vanishing point from the guide";
  drawOverlay();
}

function moveAssistantHandle(event) {
  const drag = activeAssistantDrag;
  const pointer = eventToImagePoint(event);
  const base = drag.snapshot;
  let next = cloneAssistant(base);

  if (drag.handle === "center") {
    next = translateAssistant(base, {
      x: pointer.x - drag.startPointer.x,
      y: pointer.y - drag.startPointer.y,
    });
  } else if (drag.handle === "near") {
    const ray = base.rays[drag.rayIndex];
    const fallback = subtractPoints(ray.far, base.center);
    const direction = unitDirection(subtractPoints(pointer, base.center), fallback);
    const nearDistance = distanceBetween(pointer, base.center);
    const minimumGap = displayScale(18);
    const farDistance = Math.max(
      distanceBetween(base.center, ray.far),
      nearDistance + minimumGap,
    );
    next.rays[drag.rayIndex].near = nearDistance < displayScale(4)
      ? addScaled(base.center, direction, displayScale(4))
      : pointer;
    next.rays[drag.rayIndex].far = addScaled(base.center, direction, farDistance);
  } else if (drag.handle === "far") {
    const ray = base.rays[drag.rayIndex];
    const direction = unitDirection(
      subtractPoints(pointer, ray.near),
      subtractPoints(ray.far, ray.near),
    );
    next.rays[drag.rayIndex].far = distanceBetween(pointer, ray.near) < displayScale(4)
      ? addScaled(ray.near, direction, displayScale(4))
      : pointer;
    const otherRay = next.rays[drag.rayIndex === 0 ? 1 : 0];
    const intersection = intersectInfiniteLines(
      next.rays[drag.rayIndex].near,
      next.rays[drag.rayIndex].far,
      otherRay.near,
      otherRay.far,
    );
    if (intersection) next.center = intersection;
  }

  vanishingPoints[drag.assistantIndex] = next;
  if (drag.handle !== "near") rebuildProjectionFromAssistants();
  drawOverlay();
}

function rebuildProjectionFromAssistants() {
  if (!finalized || vanishingPoints.length < 3) return;
  perspectiveProjection = buildVanishingProjection();
  if (viewMode === "perspective") {
    projection = perspectiveProjection;
    updateRenderCamera();
  }
}

function cloneAssistant(assistant) {
  return {
    center: { ...assistant.center },
    rays: assistant.rays.map((ray) => ({
      near: { ...ray.near },
      far: { ...ray.far },
    })),
  };
}

function translateAssistant(assistant, delta) {
  return {
    center: addPoints(assistant.center, delta),
    rays: assistant.rays.map((ray) => ({
      near: addPoints(ray.near, delta),
      far: addPoints(ray.far, delta),
    })),
  };
}

function addPoints(first, second) {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtractPoints(first, second) {
  return { x: first.x - second.x, y: first.y - second.y };
}

function addScaled(point, direction, scale) {
  return { x: point.x + direction.x * scale, y: point.y + direction.y * scale };
}

function distanceBetween(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function unitDirection(vector, fallback = { x: 1, y: 0 }) {
  let length = Math.hypot(vector.x, vector.y);
  if (length > 1e-8) return { x: vector.x / length, y: vector.y / length };
  length = Math.hypot(fallback.x, fallback.y) || 1;
  return { x: fallback.x / length, y: fallback.y / length };
}

function intersectInfiniteLines(firstStart, firstEnd, secondStart, secondEnd) {
  const firstDirection = subtractPoints(firstEnd, firstStart);
  const secondDirection = subtractPoints(secondEnd, secondStart);
  const denominator = cross2d(firstDirection, secondDirection);
  if (Math.abs(denominator) < 1e-8) return null;
  const offset = subtractPoints(secondStart, firstStart);
  const distance = cross2d(offset, secondDirection) / denominator;
  const point = addScaled(firstStart, firstDirection, distance);
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function cross2d(first, second) {
  return first.x * second.y - first.y * second.x;
}

function beginAxisDrag(event, axisIndex) {
  const axis = gizmoAxes.find((entry) => entry.axisIndex === axisIndex);
  if (!axis) return;
  activeAxisDrag = {
    pointerId: event.pointerId,
    axisIndex,
    startPointer: eventToImagePoint(event),
    startTranslation: [...modelTranslation],
    direction: axis.direction,
    pixelsPerWorld: axis.pixelsPerWorld,
  };
  overlay.setPointerCapture(event.pointerId);
  dragStatus.textContent = `Moving along the ${AXES[axisIndex].label} axis`;
}

function moveAlongAxis(event) {
  const point = eventToImagePoint(event);
  const deltaX = point.x - activeAxisDrag.startPointer.x;
  const deltaY = point.y - activeAxisDrag.startPointer.y;
  const screenDistance = deltaX * activeAxisDrag.direction.x
    + deltaY * activeAxisDrag.direction.y;
  const worldDistance = screenDistance / activeAxisDrag.pixelsPerWorld;
  const candidate = [...activeAxisDrag.startTranslation];
  candidate[activeAxisDrag.axisIndex] += worldDistance;
  if (!isTranslationUsable(candidate)) return;

  modelTranslation = candidate;
  applyModelTransform();
  updateRenderCamera();
  drawOverlay();
}

function isTranslationUsable(translation) {
  const center = projectPoint(projection, translation);
  return Boolean(
    center
    && Number.isFinite(center.x)
    && Number.isFinite(center.y)
    && Number.isFinite(center.depth)
    && Math.abs(center.depth) > 0.012
  );
}

function undoLastAction() {
  if (finalized) {
    finalized = false;
    perspectiveProjection = null;
    vanishingPoints.pop();
    projection = viewMode === "orthographic"
      ? buildOrthographicProjection()
      : null;
    updateRenderCamera();
  } else if (vanishingPoints.length) {
    vanishingPoints.pop();
  }
  selectedAssistantIndex = Math.min(selectedAssistantIndex, vanishingPoints.length - 1);
  mainStatus.textContent = "Undid the last step.";
  updateInterface();
}

function resetEditor() {
  vanishingPoints = [];
  finalized = false;
  perspectiveProjection = null;
  viewMode = "orthographic";
  orthoBasis = createDefaultOrthoBasis();
  resetModelPosition();
  projection = imageWidth ? buildOrthographicProjection() : null;
  activeAssistantDrag = null;
  selectedAssistantIndex = -1;
  if (imageWidth) modelInput.checked = true;
  updateRenderCamera();
  if (imageWidth) mainStatus.textContent = "Orthographic view is open.";
  updateInterface();
}

function resetModelPosition() {
  modelTranslation = [0, 0, 0];
  orthoPan = [0, 0];
  activeOrthoPan = null;
  activeAxisDrag = null;
  applyModelTransform();
}

function flipAxis(axisIndex) {
  axisSigns[axisIndex] *= -1;
  applyModelTransform();
}

function applyModelTransform() {
  modelRoot.position.set(...modelTranslation);
  modelRoot.scale.set(
    axisSigns[0] * modelDisplayScale,
    axisSigns[1] * modelDisplayScale,
    axisSigns[2] * modelDisplayScale,
  );
  const buttons = [flipXButton, flipYButton, flipZButton];
  buttons.forEach((button, index) => {
    button.setAttribute("aria-pressed", axisSigns[index] < 0 ? "true" : "false");
  });
}

function updateInterface() {
  const hasProjection = Boolean(imageWidth && projection);
  resetButton.disabled = !imageWidth;
  viewOrthoInput.disabled = !imageWidth;
  viewPerspectiveInput.disabled = !imageWidth;
  viewOrthoInput.checked = viewMode === "orthographic";
  viewPerspectiveInput.checked = viewMode === "perspective";
  modelInput.disabled = !hasProjection || !modelReady;
  playInput.disabled = !animationAction || !hasProjection || !modelReady;
  exportGifButton.disabled = exportingGif || !animationAction || !hasProjection || !modelReady;
  for (const button of [flipXButton, flipYButton, flipZButton]) {
    button.disabled = !hasProjection || !modelReady;
  }

  if (!imageWidth) {
    dragStatus.textContent = "Click the X vanishing point";
  } else if (viewMode === "orthographic") {
    dragStatus.textContent = "Orthographic: drag to pan, use edge arrows to rotate 90 degrees";
  } else if (!finalized) {
    const next = POINT_ORDER[Math.min(vanishingPoints.length, 2)];
    dragStatus.textContent = vanishingPoints.length === 2
      ? "Click the Y vanishing point; the gray area is fine"
      : `Click the ${next.label} vanishing point; the gray area is fine`;
  } else {
    dragStatus.textContent = "Drag a vanishing point helper or an axis arrow";
  }

  updatePlaybackState();
  drawOverlay();
}

function updatePlaybackState() {
  modelRoot.visible = Boolean(imageWidth && projection && modelReady && modelInput.checked);
  if (!animationAction) return;
  animationAction.paused = exportingGif || !(playInput.checked && modelRoot.visible);
  animationClock.getDelta();
}

async function loadReferenceImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      referenceImage.onload = resolve;
      referenceImage.onerror = () => reject(new Error("Unable to decode this image"));
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
  overlay.style.display = "block";
  overlay.setAttribute("preserveAspectRatio", "none");
  refreshOverlayGeometry();
  resizeRenderer();
}

function refreshOverlayGeometry() {
  if (!imageWidth || viewport.style.display === "none") return;
  const stageBounds = stage.getBoundingClientRect();
  const viewportBounds = viewport.getBoundingClientRect();
  if (stageBounds.width <= 0 || stageBounds.height <= 0
    || viewportBounds.width <= 0 || viewportBounds.height <= 0) return;

  const scaleX = imageWidth / viewportBounds.width;
  const scaleY = imageHeight / viewportBounds.height;
  const viewX = (stageBounds.left - viewportBounds.left) * scaleX;
  const viewY = (stageBounds.top - viewportBounds.top) * scaleY;
  overlay.setAttribute(
    "viewBox",
    `${viewX} ${viewY} ${stageBounds.width * scaleX} ${stageBounds.height * scaleY}`,
  );
  drawOverlay();
}

async function loadFbx(url, name) {
  const generation = ++loadGeneration;
  fbxName.textContent = name;
  modelStatus.textContent = `Reading animation bounds for ${name}...`;
  modelReady = false;
  disposeCurrentModel();
  updateInterface();

  try {
    const object = await new FBXLoader().loadAsync(url);
    if (generation !== loadGeneration) {
      disposeObject(object);
      return;
    }

    prepareModel(object);
    modelStatus.textContent = animationAction
      ? `${name} - animation loaded`
      : `${name} - static model`;
    mainStatus.textContent = imageWidth
      ? "Model is ready."
      : "Model is ready. Choose a reference image.";
  } catch (error) {
    if (generation !== loadGeneration) return;
    console.error(error);
    modelStatus.textContent = `FBX load failed: ${error.message}`;
    mainStatus.textContent = "Model load failed.";
    updateInterface();
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
    throw new Error("Model bounds are empty");
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
    for (const material of originals) material?.dispose?.();
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
  applyModelOpacity(Number(opacityInput.value) / 100);
  if (finalized) {
    perspectiveProjection = buildVanishingProjection();
    projection = viewMode === "orthographic"
      ? buildOrthographicProjection()
      : perspectiveProjection;
    updateRenderCamera();
  } else if (imageWidth && viewMode === "orthographic") {
    projection = buildOrthographicProjection();
    updateRenderCamera();
  }
  applyModelTransform();
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
    for (const material of materials) {
      for (const value of Object.values(material)) value?.isTexture && value.dispose();
      material.dispose?.();
    }
  });
}

function applyModelOpacity(opacity) {
  modelRoot.traverse((child) => {
    if (!child.isMesh) return;
    const meshOpacity = hasNameInChain(child, "Beta_Joints") ? 1 : opacity;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = meshOpacity < 0.999;
      material.opacity = meshOpacity;
      material.depthWrite = meshOpacity >= 0.999 || meshOpacity > 0.55;
      material.needsUpdate = true;
    }
  });
}

function hasNameInChain(object, fragment) {
  for (let current = object; current; current = current.parent) {
    if (current.name?.includes(fragment)) return true;
    if (current === modelRoot) break;
  }
  return false;
}

function updateRenderCamera() {
  if (!projection) {
    renderer.clear();
    return;
  }
  const transformedVertices = boxVertices.map((vertex) => vertex.map(
    (value, index) => value * modelDisplayScale + modelTranslation[index],
  ));
  const rows = viewMode === "orthographic"
    ? buildOrthographicClipRows(transformedVertices)
    : buildClipRows(projection, transformedVertices);
  if (!rows) return;
  renderCamera.projectionMatrix.set(...rows.flat());
  renderCamera.projectionMatrixInverse.copy(renderCamera.projectionMatrix).invert();
  renderCamera.matrixWorld.identity();
  renderCamera.matrixWorldInverse.identity();
}

async function exportGif() {
  if (exportingGif || !animationAction || !projection || !imageWidth || !modelReady) return;

  const clip = animationAction.getClip();
  const duration = Number.isFinite(clip?.duration) && clip.duration > 0
    ? clip.duration
    : 1;
  const frameCount = Math.min(GIF_MAX_FRAMES, Math.max(2, Math.ceil(duration * GIF_TARGET_FPS)));
  const delay = Math.max(2, Math.min(65535, Math.round((duration * 100) / frameCount)));
  const sizeScale = GIF_MAXIMUM_SIDE / Math.max(imageWidth, imageHeight);
  const budgetScale = Math.sqrt(GIF_PIXEL_BUDGET / (frameCount * imageWidth * imageHeight));
  const exportScale = Math.min(1, sizeScale, budgetScale);
  const exportWidth = Math.max(1, Math.round(imageWidth * exportScale));
  const exportHeight = Math.max(1, Math.round(imageHeight * exportScale));
  const previousSize = renderer.getSize(new THREE.Vector2());
  const previousPixelRatio = renderer.getPixelRatio();
  const previousMixerTime = mixer?.time ?? 0;
  const previousVisible = modelRoot.visible;
  const previousPaused = animationAction.paused;
  const captureCanvas = document.createElement("canvas");
  const captureContext = captureCanvas.getContext("2d", { willReadFrequently: true });
  if (!captureContext) return;
  const gifEncoder = new GifEncoder(exportWidth, exportHeight, delay);

  exportingGif = true;
  exportStatus.textContent = "Exporting GIF...";
  updateInterface();

  try {
    captureCanvas.width = exportWidth;
    captureCanvas.height = exportHeight;
    modelRoot.visible = true;
    animationAction.paused = false;
    applyModelOpacity(1);
    renderer.setPixelRatio(1);
    renderer.setSize(exportWidth, exportHeight, false);

    for (let index = 0; index < frameCount; index += 1) {
      const time = (duration * index) / frameCount;
      mixer.setTime(time);
      renderer.clear();
      renderer.render(scene, renderCamera);
      captureContext.clearRect(0, 0, exportWidth, exportHeight);
      captureContext.drawImage(threeCanvas, 0, 0, exportWidth, exportHeight);
      const imageData = captureContext.getImageData(0, 0, exportWidth, exportHeight);
      gifEncoder.addFrame(imageData.data);
      if (index % 4 === 0) {
        exportStatus.textContent = `Exporting GIF ${Math.round(((index + 1) / frameCount) * 100)}%`;
        await nextFrame();
      }
    }

    const blob = new Blob([gifEncoder.finish()], {
      type: "image/gif",
    });
    downloadBlob(blob, `${baseFileName(fbxName.textContent || "3DAni")}.gif`);
    exportStatus.textContent = "GIF exported.";
  } catch (error) {
    console.error(error);
    exportStatus.textContent = `GIF export failed: ${error.message}`;
  } finally {
    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(previousSize.x, previousSize.y, false);
    if (mixer) mixer.setTime(previousMixerTime);
    modelRoot.visible = previousVisible;
    animationAction.paused = previousPaused;
    applyModelOpacity(Number(opacityInput.value) / 100);
    animationClock.getDelta();
    exportingGif = false;
    updatePlaybackState();
    updateInterface();
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function baseFileName(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    || "3DAni";
}

function buildOrthographicClipRows(vertices) {
  const depths = vertices.map((vertex) => dot3(orthoBasis.depth, vertex));
  const minimum = Math.min(...depths);
  const maximum = Math.max(...depths);
  const range = Math.max(maximum - minimum, 0.1);
  const scale = 1.8 / range;
  const offset = -scale * (minimum + maximum) / 2;
  return [
    [...projection[0]],
    [...projection[1]],
    [
      orthoBasis.depth[0] * scale,
      orthoBasis.depth[1] * scale,
      orthoBasis.depth[2] * scale,
      offset,
    ],
    [...projection[2]],
  ];
}

function drawOverlay() {
  overlay.replaceChildren();
  gizmoAxes = [];
  if (!imageWidth) return;

  const origin = projection
    ? projectToImage(modelTranslation)
    : { x: imageWidth / 2, y: imageHeight / 2 };

  if (viewMode === "orthographic") {
    drawOrthoPanHandle(origin);
    drawViewportEdgeControls();
    return;
  }

  vanishingPoints.forEach((assistant, index) => {
    drawAssistantGuides(
      assistant,
      index,
      index === selectedAssistantIndex,
    );
  });

  if (finalized && projection) drawGizmo(origin);

  vanishingPoints.forEach((assistant, index) => {
    drawAssistantHandles(assistant, index, false);
  });
}

function drawViewportEdgeControls() {
  const inset = displayScale(24);
  const controls = [
    { edge: "left", x: inset, y: imageHeight / 2, dx: -1, dy: 0 },
    { edge: "right", x: imageWidth - inset, y: imageHeight / 2, dx: 1, dy: 0 },
    { edge: "top", x: imageWidth / 2, y: inset, dx: 0, dy: -1 },
    { edge: "bottom", x: imageWidth / 2, y: imageHeight - inset, dx: 0, dy: 1 },
  ];

  controls.forEach((control) => {
    overlay.appendChild(createSvg("circle", {
      cx: control.x,
      cy: control.y,
      r: displayScale(15),
      fill: "rgba(255,255,255,0.92)",
      stroke: viewMode === "orthographic" ? "#1f5fae" : "#50555b",
      ...screenStroke(2),
      "pointer-events": "all",
      "data-ortho-edge": control.edge,
      style: "cursor: pointer;",
    }));
    const tip = {
      x: control.x + control.dx * displayScale(7),
      y: control.y + control.dy * displayScale(7),
    };
    const base = {
      x: control.x - control.dx * displayScale(4),
      y: control.y - control.dy * displayScale(4),
    };
    const perpendicular = { x: -control.dy, y: control.dx };
    overlay.appendChild(createSvg("line", {
      x1: base.x,
      y1: base.y,
      x2: tip.x,
      y2: tip.y,
      stroke: viewMode === "orthographic" ? "#1f5fae" : "#50555b",
      ...screenStroke(2),
      "stroke-linecap": "round",
      "pointer-events": "none",
    }));
    overlay.appendChild(createSvg("polygon", {
      points: [
        `${tip.x},${tip.y}`,
        `${tip.x - control.dx * displayScale(6) + perpendicular.x * displayScale(4)},${tip.y - control.dy * displayScale(6) + perpendicular.y * displayScale(4)}`,
        `${tip.x - control.dx * displayScale(6) - perpendicular.x * displayScale(4)},${tip.y - control.dy * displayScale(6) - perpendicular.y * displayScale(4)}`,
      ].join(" "),
      fill: viewMode === "orthographic" ? "#1f5fae" : "#50555b",
      "pointer-events": "none",
    }));
  });
}

function drawOrthoPanHandle(origin) {
  const color = "#1f5fae";
  const arm = displayScale(14);
  overlay.appendChild(createSvg("circle", {
    cx: origin.x,
    cy: origin.y,
    r: displayScale(17),
    fill: "rgba(255,255,255,0.92)",
    stroke: color,
    ...screenStroke(2),
    "pointer-events": "none",
  }));
  overlay.appendChild(createSvg("line", {
    x1: origin.x - arm,
    y1: origin.y,
    x2: origin.x + arm,
    y2: origin.y,
    stroke: color,
    ...screenStroke(2),
    "stroke-linecap": "round",
    "pointer-events": "none",
  }));
  overlay.appendChild(createSvg("line", {
    x1: origin.x,
    y1: origin.y - arm,
    x2: origin.x,
    y2: origin.y + arm,
    stroke: color,
    ...screenStroke(2),
    "stroke-linecap": "round",
    "pointer-events": "none",
  }));
  overlay.appendChild(createSvg("circle", {
    cx: origin.x,
    cy: origin.y,
    r: displayScale(25),
    fill: "rgba(0,0,0,0.001)",
    "pointer-events": "all",
    "data-ortho-pan": "true",
    style: "cursor: move;",
  }));
}

function drawAssistantGuides(assistant, index, showFan) {
  if (showFan) {
    for (let step = 0; step < 18; step += 1) {
      const angle = (step * Math.PI) / 18;
      drawInfiniteGuide(
        assistant.center,
        addScaled(assistant.center, { x: Math.cos(angle), y: Math.sin(angle) }, 1),
        {
          stroke: "#6f747a",
          opacity: 0.16,
          dasharray: "none",
        },
      );
    }
  }

  assistant.rays.forEach((ray) => {
    drawInfiniteGuide(assistant.center, ray.far, {
      stroke: "#656a70",
      opacity: 0.58,
      dasharray: "none",
    });
    overlay.appendChild(createSvg("line", {
      x1: assistant.center.x,
      y1: assistant.center.y,
      x2: ray.far.x,
      y2: ray.far.y,
      stroke: POINT_ORDER[index].color,
      "stroke-opacity": "0.48",
      ...screenStroke(2),
      "pointer-events": "none",
    }));
  });
}

function drawAssistantHandles(assistant, index, isDraft) {
  const definition = POINT_ORDER[index];
  assistant.rays.forEach((ray, rayIndex) => {
    drawHelperHandle(ray.near, index, rayIndex, "near", isDraft, "#b5b9be");
    drawHelperHandle(ray.far, index, rayIndex, "far", isDraft, "#858b92");
  });

  overlay.appendChild(createSvg("circle", {
    cx: assistant.center.x,
    cy: assistant.center.y,
    r: displayScale(isDraft ? 8 : 7),
    fill: "#fff",
    stroke: definition.color,
    ...screenStroke(),
    "pointer-events": isDraft ? "none" : "all",
    "data-vp-index": index,
    "data-vp-handle": "center",
    style: isDraft ? "" : "cursor: move;",
  }));

  const label = createSvg("text", {
    x: assistant.center.x + displayScale(11),
    y: assistant.center.y - displayScale(11),
    fill: definition.color,
    "font-size": displayScale(12),
    "font-family": "Inter, sans-serif",
    "font-weight": "700",
    "pointer-events": "none",
  });
  label.textContent = definition.label;
  overlay.appendChild(label);
}

function drawHelperHandle(point, assistantIndex, rayIndex, handle, isDraft, fill) {
  overlay.appendChild(createSvg("circle", {
    cx: point.x,
    cy: point.y,
    r: displayScale(handle === "near" ? 6 : 6.5),
    fill,
    stroke: "#fff",
    ...screenStroke(2),
    "pointer-events": isDraft ? "none" : "all",
    "data-vp-index": assistantIndex,
    "data-vp-handle": handle,
    "data-ray-index": rayIndex,
    style: isDraft ? "" : "cursor: grab;",
  }));
}

function drawGizmo(origin) {
  const arrowLength = displayScale(76);
  const headLength = displayScale(12);
  const headWidth = displayScale(7);

  for (const axis of AXES) {
    const data = axisProjectionData(axis.index, origin);
    if (!data) continue;
    gizmoAxes.push({ axisIndex: axis.index, ...data });
    const end = {
      x: origin.x + data.direction.x * arrowLength,
      y: origin.y + data.direction.y * arrowLength,
    };
    const base = {
      x: end.x - data.direction.x * headLength,
      y: end.y - data.direction.y * headLength,
    };
    const perpendicular = { x: -data.direction.y, y: data.direction.x };

    overlay.appendChild(createSvg("line", {
      x1: origin.x,
      y1: origin.y,
      x2: base.x,
      y2: base.y,
      stroke: axis.color,
      ...screenStroke(),
      "stroke-linecap": "round",
      "pointer-events": "none",
    }));
    overlay.appendChild(createSvg("polygon", {
      points: [
        `${end.x},${end.y}`,
        `${base.x + perpendicular.x * headWidth},${base.y + perpendicular.y * headWidth}`,
        `${base.x - perpendicular.x * headWidth},${base.y - perpendicular.y * headWidth}`,
      ].join(" "),
      fill: axis.color,
      "pointer-events": "none",
    }));

    const label = createSvg("text", {
      x: end.x + data.direction.x * displayScale(8),
      y: end.y + data.direction.y * displayScale(8),
      fill: axis.color,
      "font-size": displayScale(12),
      "font-family": "Inter, sans-serif",
      "font-weight": "700",
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "pointer-events": "none",
    });
    label.textContent = axis.label;
    overlay.appendChild(label);

    overlay.appendChild(createSvg("line", {
      x1: origin.x,
      y1: origin.y,
      x2: end.x,
      y2: end.y,
      stroke: "rgba(0,0,0,0.001)",
      ...screenStroke(28),
      "stroke-linecap": "round",
      "pointer-events": "stroke",
      "data-gizmo-axis": axis.index,
      style: "cursor: grab;",
    }));
    overlay.appendChild(createSvg("circle", {
      cx: end.x,
      cy: end.y,
      r: displayScale(14),
      fill: "rgba(0,0,0,0.001)",
      "pointer-events": "all",
      "data-gizmo-axis": axis.index,
      style: "cursor: grab;",
    }));
  }

  overlay.appendChild(createSvg("circle", {
    cx: origin.x,
    cy: origin.y,
    r: displayScale(6),
    fill: "#fff",
    stroke: "#303134",
    ...screenStroke(2),
    "pointer-events": "none",
  }));
}

function axisProjectionData(axisIndex, origin) {
  const step = 0.2;
  const nextPosition = [...modelTranslation];
  nextPosition[axisIndex] += step;
  const next = projectToImage(nextPosition);
  let dx = next.x - origin.x;
  let dy = next.y - origin.y;
  let length = Math.hypot(dx, dy);

  if (!Number.isFinite(length) || length < displayScale(2)) {
    const fallback = axisIndex === 0
      ? { x: 1, y: 0 }
      : axisIndex === 1 ? { x: 0, y: -1 } : { x: 0.7, y: 0.7 };
    dx = fallback.x;
    dy = fallback.y;
    length = Math.hypot(dx, dy);
  }

  return {
    direction: { x: dx / length, y: dy / length },
    pixelsPerWorld: Math.min(
      Math.max(length / step, displayScale(28)),
      displayScale(720),
    ),
  };
}

function drawInfiniteGuide(first, second, options = {}) {
  const clipped = clipInfiniteLine(first, second);
  if (!clipped) return;
  overlay.appendChild(createSvg("line", {
    x1: clipped[0].x,
    y1: clipped[0].y,
    x2: clipped[1].x,
    y2: clipped[1].y,
    stroke: options.stroke ?? "#777c82",
    "stroke-opacity": options.opacity ?? "0.42",
    ...screenStroke(),
    "stroke-dasharray": options.dasharray ?? "6 5",
    "pointer-events": "none",
  }));
}

function projectToImage(position) {
  const point = projectPoint(projection, position);
  return point ? fromNormalizedPoint(point) : { x: imageWidth / 2, y: imageHeight / 2 };
}

function clipInfiniteLine(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-8) return null;
  const viewBox = overlay.viewBox.baseVal;
  const minX = viewBox.x;
  const maxX = viewBox.x + viewBox.width;
  const minY = viewBox.y;
  const maxY = viewBox.y + viewBox.height;
  const candidates = [];
  if (Math.abs(dx) > 1e-8) {
    for (const x of [minX, maxX]) {
      const t = (x - from.x) / dx;
      const y = from.y + t * dy;
      if (y >= minY && y <= maxY) candidates.push({ x, y, t });
    }
  }
  if (Math.abs(dy) > 1e-8) {
    for (const y of [minY, maxY]) {
      const t = (y - from.y) / dy;
      const x = from.x + t * dx;
      if (x >= minX && x <= maxX) candidates.push({ x, y, t });
    }
  }
  if (candidates.length < 2) return null;
  candidates.sort((left, right) => left.t - right.t);
  return [candidates[0], candidates[candidates.length - 1]];
}

function createSvg(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function screenStroke(width = OVERLAY_STROKE_WIDTH) {
  return {
    "stroke-width": width,
    "vector-effect": "non-scaling-stroke",
  };
}

function eventToImagePoint(event) {
  const matrix = overlay.getScreenCTM();
  if (matrix) {
    const point = overlay.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  const bounds = overlay.getBoundingClientRect();
  const viewBox = overlay.viewBox.baseVal;
  return {
    x: viewBox.x + ((event.clientX - bounds.left) / bounds.width) * viewBox.width,
    y: viewBox.y + ((event.clientY - bounds.top) / bounds.height) * viewBox.height,
  };
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

function displayScale(cssPixels) {
  const width = viewport.getBoundingClientRect().width;
  return width > 0 ? cssPixels * (imageWidth / width) : cssPixels;
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
    if (!exportingGif && mixer && animationAction && !animationAction.paused) mixer.update(delta);
    if (projection && imageWidth) renderer.render(scene, renderCamera);
  };
  tick();
}
