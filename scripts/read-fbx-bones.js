#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const filePath = process.argv[2] || "Walking.fbx";
const shouldPrintJson = process.argv.includes("--json");
const shouldDebugConnections = process.argv.includes("--debug-connections");
const shouldDebugParents = process.argv.includes("--debug-parents");
const targetNames = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightArm",
  "RightForeArm",
  "RightHand",
];

const buffer = readFileSync(filePath);
const magic = buffer.subarray(0, 23).toString("binary");

if (magic !== "Kaydara FBX Binary  \x00\x1a\x00") {
  throw new Error("这个脚本目前只处理 Binary FBX。");
}

let offset = 23;
const version = readUInt32();
const use64BitNodeHeader = version >= 7500;
const roots = [];

while (offset < buffer.length) {
  const node = readNode();
  if (!node) break;
  roots.push(node);
}

const objectsNode = roots.find((node) => node.name === "Objects");
const connectionsNode = roots.find((node) => node.name === "Connections");

if (!objectsNode) throw new Error("FBX 里没有 Objects 节点。");

const models = readModels(objectsNode);
const parentByChild = readConnections(connectionsNode, models);
const poseMatrices = readPoseMatrices(objectsNode);

if (shouldDebugConnections) {
  debugConnections(connectionsNode, models);
  process.exit(0);
}

if (shouldDebugParents) {
  debugParents(models, parentByChild);
  process.exit(0);
}
const bones = [...models.values()]
  .filter((model) => model.type === "LimbNode" || shortBoneName(model.name).startsWith("mixamorig"))
  .map((model) => {
    const matrix = poseMatrices.get(model.idKey);
    const localTranslation = vectorProperty(model.properties, "Lcl Translation");
    const position = matrix ? positionFromMatrix(matrix) : null;

    return {
      idKey: model.idKey,
      name: model.name,
      shortName: shortBoneName(model.name),
      parentIdKey: parentByChild.get(model.idKey) || null,
      localTranslation,
      worldPosition: position || localTranslation,
      hasBindPoseMatrix: Boolean(matrix),
    };
  });

for (const bone of bones) {
  bone.parentName = bone.parentIdKey && models.has(bone.parentIdKey)
    ? models.get(bone.parentIdKey).name
    : null;
  delete bone.parentIdKey;
}

if (shouldPrintJson) {
  console.log(JSON.stringify(buildResultJson(), null, 2));
  process.exit(0);
}

console.log(`FBX: ${filePath}`);
console.log(`FBX version: ${version}`);
console.log(`Bones found: ${bones.length}`);
console.log("");

console.log("常用关节点坐标（FBX 模型空间 / bind pose 世界坐标）：");
for (const name of targetNames) {
  const bone = findBone(bones, name);
  if (!bone) continue;

  const p = bone.worldPosition;
  console.log(
    `${name.padEnd(13)} -> ${bone.name.padEnd(32)} x=${fmt(p.x)} y=${fmt(p.y)} z=${fmt(p.z)}`
  );
}

console.log("");
console.log("膝盖：");
printJoint("Left knee", findBone(bones, "LeftLeg"));
printJoint("Right knee", findBone(bones, "RightLeg"));

console.log("");
console.log("需要完整 JSON 时，使用 package.json 里的 bones:json 脚本。");

process.exit(0);

function buildResultJson() {
  return {
  filePath,
  version,
  boneCount: bones.length,
  notes: {
    knee:
      "Mixamo 里膝盖通常是 LeftLeg / RightLeg 这两根小腿骨的起点，也就是 LeftUpLeg / RightUpLeg 的末端。",
    coordinateSpace:
      "这里优先使用 FBX BindPose 矩阵里的世界坐标；如果没有 BindPose，则退回到 Lcl Translation。",
  },
  bones: bones.map((bone) => ({
    name: bone.name,
    shortName: bone.shortName,
    parentName: bone.parentName,
    worldPosition: roundVector(bone.worldPosition),
    localTranslation: roundVector(bone.localTranslation),
      hasBindPoseMatrix: bone.hasBindPoseMatrix,
  })),
  };
}

function readNode() {
  const endOffset = readOffsetField();
  const propertyCount = readOffsetField();
  const propertyListLength = readOffsetField();
  const nameLength = readUInt8();

  if (endOffset === 0 && propertyCount === 0 && propertyListLength === 0 && nameLength === 0) {
    return null;
  }

  const name = readString(nameLength);
  const properties = [];
  const propertyEnd = offset + propertyListLength;

  for (let index = 0; index < propertyCount; index++) {
    properties.push(readProperty());
  }

  // 有些文件属性长度字段可能比逐项读取更可信；对齐到属性区结束。
  offset = Math.max(offset, propertyEnd);

  const children = [];
  while (offset < endOffset) {
    const child = readNode();
    if (!child) break;
    children.push(child);
  }

  offset = endOffset;
  return { name, properties, children };
}

function readProperty() {
  const type = readString(1);

  switch (type) {
    case "Y": return readInt16();
    case "C": return Boolean(readUInt8());
    case "I": return readInt32();
    case "F": return readFloat32();
    case "D": return readFloat64();
    case "L": return readInt64();
    case "S": return readLengthPrefixedString();
    case "R": return readRawBytes();
    case "f": return readArray(4, (view, byteOffset) => view.getFloat32(byteOffset, true));
    case "d": return readArray(8, (view, byteOffset) => view.getFloat64(byteOffset, true));
    case "i": return readArray(4, (view, byteOffset) => view.getInt32(byteOffset, true));
    case "l": return readArray(8, (view, byteOffset) => view.getBigInt64(byteOffset, true));
    case "b": return readArray(1, (view, byteOffset) => Boolean(view.getUint8(byteOffset)));
    default:
      throw new Error(`未知 FBX 属性类型：${type}，offset=${offset - 1}`);
  }
}

function readArray(bytesPerValue, reader) {
  const length = readUInt32();
  const encoding = readUInt32();
  const compressedLength = readUInt32();
  const payload = buffer.subarray(offset, offset + compressedLength);
  offset += compressedLength;

  const data = encoding === 0 ? payload : inflateSync(payload);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result = [];

  for (let index = 0; index < length; index++) {
    result.push(reader(view, index * bytesPerValue));
  }

  return result;
}

function readModels(objectsNode) {
  const models = new Map();

  for (const node of objectsNode.children) {
    if (node.name !== "Model") continue;

    const id = node.properties[0];
    const name = cleanFBXName(node.properties[1]);
    const type = cleanFBXName(node.properties[2]);

    models.set(toKey(id), {
      id,
      idKey: toKey(id),
      name,
      type,
      properties: readProperties70(node),
    });
  }

  return models;
}

function readProperties70(node) {
  const result = new Map();
  const properties70 = node.children.find((child) => child.name === "Properties70");
  if (!properties70) return result;

  for (const property of properties70.children) {
    if (property.name !== "P") continue;
    const name = cleanFBXName(property.properties[0]);
    result.set(name, property.properties.slice(4));
  }

  return result;
}

function readConnections(connectionsNode, models) {
  const parentByChild = new Map();
  if (!connectionsNode) return parentByChild;

  for (const node of connectionsNode.children) {
    if (node.name !== "C" || !cleanFBXName(node.properties[0]).startsWith("OO")) continue;
    const childKey = toKey(node.properties[1]);
    const parentKey = toKey(node.properties[2]);

    if (!models.has(childKey) || !models.has(parentKey)) continue;
    if (!parentByChild.has(childKey)) {
      parentByChild.set(childKey, parentKey);
    }
  }

  return parentByChild;
}

function debugConnections(connectionsNode, models) {
  if (!connectionsNode) {
    console.log("没有 Connections 节点。");
    return;
  }

  let count = 0;
  for (const node of connectionsNode.children) {
    if (node.name !== "C") continue;
    const relation = cleanFBXName(node.properties[0]);
    const childKey = toKey(node.properties[1]);
    const parentKey = toKey(node.properties[2]);
    const childName = models.get(childKey)?.name || "(not model)";
    const parentName = models.get(parentKey)?.name || "(not model)";
    console.log(`${relation}: ${childKey} ${childName} -> ${parentKey} ${parentName}`);
    count++;
    if (count >= 40) break;
  }

  console.log(`shown ${count} connections`);
}

function debugParents(models, parentByChild) {
  console.log(`models=${models.size}, parentByChild=${parentByChild.size}`);
  for (const model of models.values()) {
    if (!["mixamorig:Spine", "mixamorig:LeftLeg", "mixamorig:RightLeg"].includes(model.name)) continue;
    const parentKey = parentByChild.get(model.idKey);
    console.log({
      name: model.name,
      idKey: model.idKey,
      parentKey,
      parentName: parentKey ? models.get(parentKey)?.name : null,
    });
  }
}

function readPoseMatrices(objectsNode) {
  const matrices = new Map();

  for (const pose of objectsNode.children) {
    if (pose.name !== "Pose") continue;

    for (const poseNode of pose.children) {
      if (poseNode.name !== "PoseNode") continue;

      const nodeRef = poseNode.children.find((child) => child.name === "Node");
      const matrixRef = poseNode.children.find((child) => child.name === "Matrix");
      if (!nodeRef || !matrixRef) continue;

      const matrix = matrixRef.properties[0];
      if (!Array.isArray(matrix) || matrix.length !== 16) continue;

      matrices.set(toKey(nodeRef.properties[0]), matrix.map(Number));
    }
  }

  return matrices;
}

function vectorProperty(properties, name) {
  const values = properties.get(name);
  if (!values || values.length < 3) return { x: 0, y: 0, z: 0 };

  return {
    x: Number(values[0]),
    y: Number(values[1]),
    z: Number(values[2]),
  };
}

function positionFromMatrix(matrix) {
  // FBXLoader / three.js Matrix4.fromArray 使用的平移项是 12,13,14。
  return {
    x: Number(matrix[12]),
    y: Number(matrix[13]),
    z: Number(matrix[14]),
  };
}

function findBone(bones, target) {
  const lowered = target.toLowerCase();
  return bones.find((bone) => bone.shortName.toLowerCase() === lowered)
    || bones.find((bone) => bone.name.toLowerCase().endsWith(lowered));
}

function printJoint(label, bone) {
  if (!bone) {
    console.log(`${label}: 没找到`);
    return;
  }

  const p = bone.worldPosition;
  console.log(`${label}: ${bone.name} -> x=${fmt(p.x)} y=${fmt(p.y)} z=${fmt(p.z)}`);
}

function cleanFBXName(value) {
  return String(value ?? "")
    .replace(/\u0000.*$/u, "")
    .replace(/^Model::/u, "")
    .trim();
}

function shortBoneName(name) {
  return cleanFBXName(name)
    .replace(/^mixamorig[:_]?/iu, "")
    .replace(/^mixamo[:_]?/iu, "");
}

function roundVector(vector) {
  if (!vector) return null;
  return {
    x: Number(vector.x.toFixed(4)),
    y: Number(vector.y.toFixed(4)),
    z: Number(vector.z.toFixed(4)),
  };
}

function fmt(value) {
  return Number(value).toFixed(4).padStart(10);
}

function toKey(value) {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function readOffsetField() {
  if (!use64BitNodeHeader) return readUInt32();
  const value = buffer.readBigUInt64LE(offset);
  offset += 8;
  return Number(value);
}

function readLengthPrefixedString() {
  const length = readUInt32();
  return readString(length);
}

function readRawBytes() {
  const length = readUInt32();
  const value = buffer.subarray(offset, offset + length);
  offset += length;
  return value;
}

function readString(length) {
  const value = buffer.subarray(offset, offset + length).toString("utf8");
  offset += length;
  return value;
}

function readUInt8() {
  const value = buffer.readUInt8(offset);
  offset += 1;
  return value;
}

function readInt16() {
  const value = buffer.readInt16LE(offset);
  offset += 2;
  return value;
}

function readUInt32() {
  const value = buffer.readUInt32LE(offset);
  offset += 4;
  return value;
}

function readInt32() {
  const value = buffer.readInt32LE(offset);
  offset += 4;
  return value;
}

function readFloat32() {
  const value = buffer.readFloatLE(offset);
  offset += 4;
  return value;
}

function readFloat64() {
  const value = buffer.readDoubleLE(offset);
  offset += 8;
  return value;
}

function readInt64() {
  const value = buffer.readBigInt64LE(offset);
  offset += 8;
  return value;
}
