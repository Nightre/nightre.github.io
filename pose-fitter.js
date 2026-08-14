let fitterSequence = 0;

export class PoseFitter {
  constructor(options) {
    this.THREE = options.THREE;
    this.tf = options.tf;
    this.model = options.model;
    this.scene = options.scene;
    this.camera = options.camera;
    this.renderer = options.renderer;
    this.points = options.points;
    this.steps = options.steps;
    this.connections = options.connections;
    this.populationSize = options.populationSize || 20;
    this.cameraLearningRate = options.cameraLearningRate || 0.0015;
    this.boneLearningRate = options.boneLearningRate || 0.035;
    this.boneInitialRotationRadians = options.boneInitialRotationRadians ?? 0.55;
    this.onProgress = options.onProgress || (() => {});
    this.cancelled = false;
    this.disposed = false;
    this.disposables = [];
    this.sequence = ++fitterSequence;
    this.bestIndex = 0;
    this.candidateLosses = Array(this.populationSize).fill(Infinity);

    this.prepareRestPose();
    this.buildRig();
    this.buildTargets();
    this.buildVariables();
  }

  prepareRestPose() {
    this.model.traverse((object) => {
      if (!object.isBone) return;

      const saved = object.userData.poseFitRestQuaternion;
      if (saved) {
        object.quaternion.fromArray(saved);
      } else {
        object.userData.poseFitRestQuaternion = object.quaternion.toArray();
      }
    });

    this.scene.updateMatrixWorld(true);
  }

  buildRig() {
    const THREE = this.THREE;
    const bones = [];
    this.model.traverse((object) => {
      if (object.isBone) bones.push(object);
    });

    const boneSet = new Set(bones);
    const nearestBoneParent = (bone) => {
      let parent = bone.parent;
      while (parent && !boneSet.has(parent)) parent = parent.parent;
      return parent && boneSet.has(parent) ? parent : null;
    };
    const depth = (bone) => {
      let value = 0;
      let parent = nearestBoneParent(bone);
      while (parent) {
        value += 1;
        parent = nearestBoneParent(parent);
      }
      return value;
    };

    bones.sort((a, b) => depth(a) - depth(b));
    const indexByBone = new Map(bones.map((bone, index) => [bone, index]));
    const endOffsetForBone = (bone, restWorld) => {
      const inverseRestWorld = restWorld.clone().invert();
      const bestOffset = new THREE.Vector3();
      let bestDistance = 0;

      bone.traverse((child) => {
        if (child === bone || !child.isBone) return;

        const offset = new THREE.Vector3()
          .setFromMatrixPosition(child.matrixWorld)
          .applyMatrix4(inverseRestWorld);
        const distance = offset.lengthSq();
        if (distance > bestDistance) {
          bestDistance = distance;
          bestOffset.copy(offset);
        }
      });

      if (bestDistance > 1e-8) return bestOffset;

      const parent = nearestBoneParent(bone);
      const parentPosition = new THREE.Vector3();
      const bonePosition = new THREE.Vector3();
      parent?.getWorldPosition(parentPosition);
      bone.getWorldPosition(bonePosition);
      const fallbackLength = Math.max(
        parent ? parentPosition.distanceTo(bonePosition) * 0.35 : 1,
        1,
      );
      const fallbackDirection = shortBoneName(bone.name).includes("foot")
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0, 0);
      return fallbackDirection.multiplyScalar(fallbackLength);
    };

    this.rig = bones.map((bone) => {
      const parent = nearestBoneParent(bone);
      const parentIndex = parent ? indexByBone.get(parent) : -1;
      const restWorld = bone.matrixWorld.clone();
      const restRelative = parent
        ? parent.matrixWorld.clone().invert().multiply(restWorld)
        : restWorld;
      const endOffset = endOffsetForBone(bone, restWorld);

      return {
        bone,
        shortName: shortBoneName(bone.name),
        parentIndex,
        endOffset,
        restQuaternion: bone.quaternion.clone(),
        restRelativeTensor: this.track(matrix4BatchTensor(
          this.tf,
          restRelative,
          this.populationSize,
        )),
        endOffsetTensor: this.track(vector4BatchTensor(
          this.tf,
          endOffset,
          this.populationSize,
        )),
      };
    });

    this.indexByShortName = new Map();
    this.rig.forEach((entry, index) => {
      if (!this.indexByShortName.has(entry.shortName)) {
        this.indexByShortName.set(entry.shortName, index);
      }
    });
  }

  buildTargets() {
    const selectedIds = new Set(Object.keys(this.points));
    this.targets = [];

    for (const step of this.steps) {
      const point = this.points[step.id];
      const boneIndex = this.indexByShortName.get(shortBoneName(step.boneName));
      if (!point || boneIndex === undefined) continue;
      this.targets.push({
        id: step.id,
        boneIndex,
        targetKind: step.targetKind || "start",
        x: point.nx,
        y: point.ny,
      });
    }

    if (this.targets.length < 3) {
      throw new Error("至少需要 3 个可识别的关节点才能拟合相机。");
    }

    this.targetIndices = new Set(this.targets.map((target) => target.boneIndex));
    this.targetKeys = new Set(this.targets.map(targetKey));
    this.requiredIndices = new Set();
    for (const target of this.targets) {
      let index = target.boneIndex;
      while (index >= 0) {
        this.requiredIndices.add(index);
        index = this.rig[index].parentIndex;
      }
    }

    const activeIndices = new Set();
    for (const target of this.targets) {
      if (target.targetKind === "end") activeIndices.add(target.boneIndex);
    }

    for (const [fromId, toId] of this.connections) {
      if (!selectedIds.has(fromId) || !selectedIds.has(toId)) continue;
      const fromStep = this.steps.find((step) => step.id === fromId);
      const toStep = this.steps.find((step) => step.id === toId);
      const fromIndex = this.indexByShortName.get(shortBoneName(fromStep?.boneName));
      const toIndex = this.indexByShortName.get(shortBoneName(toStep?.boneName));
      if (fromIndex === undefined || toIndex === undefined) continue;

      if (fromIndex === toIndex) {
        activeIndices.add(fromIndex);
        continue;
      }

      if (this.isAncestor(fromIndex, toIndex)) activeIndices.add(fromIndex);
      if (this.isAncestor(toIndex, fromIndex)) activeIndices.add(toIndex);
    }

    this.activeIndices = [...activeIndices];
    this.targetTensor = this.track(this.tf.tensor2d(
      this.targets.map((target) => [target.x, target.y]),
      [this.targets.length, 2],
      "float32",
    ));
  }

  buildVariables() {
    const tf = this.tf;
    const THREE = this.THREE;
    const restPositions = this.targets.map((target) => {
      const entry = this.rig[target.boneIndex];
      if (target.targetKind === "end") {
        return entry.endOffset.clone().applyMatrix4(entry.bone.matrixWorld);
      }

      const position = new THREE.Vector3();
      entry.bone.getWorldPosition(position);
      return position;
    });
    const bounds = new THREE.Box3().setFromPoints(restPositions);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    this.modelScale = Math.max(size.y, size.x, size.z, 1);

    const ys = this.targets.map((target) => target.y);
    const targetHeight = Math.max(Math.max(...ys) - Math.min(...ys), 0.12);
    const initialFovRadians = THREE.MathUtils.degToRad(40);
    const initialFocal = 1 / Math.tan(initialFovRadians / 2);
    const baseDistance = Math.max(
      this.modelScale * initialFocal / (2 * targetHeight),
      this.modelScale * 1.5,
    );
    const cameraSeeds = this.randomCameraSeeds(center, baseDistance, initialFovRadians);
    const tag = `poseFit${this.sequence}`;

    this.initialEye = this.track(tf.tensor2d(cameraSeeds.eyes));
    this.initialTarget = this.track(tf.tensor2d(cameraSeeds.targets));
    this.initialUp = this.track(tf.tensor2d(cameraSeeds.ups));
    this.initialFov = this.track(tf.tensor1d(cameraSeeds.fovs));

    this.eyeVar = this.track(tf.variable(this.initialEye.clone(), true, `${tag}Eye`));
    this.targetVar = this.track(tf.variable(this.initialTarget.clone(), true, `${tag}Target`));
    this.upVar = this.track(tf.variable(this.initialUp.clone(), true, `${tag}Up`));
    this.fovVar = this.track(tf.variable(
      this.initialFov.clone(),
      true,
      `${tag}Fov`,
    ));

    this.rotationVars = new Map();
    for (const index of this.activeIndices) {
      const initialRotations = this.boneInitialRotationRadians > 0
        ? tf.randomUniform(
          [this.populationSize, 3],
          -this.boneInitialRotationRadians,
          this.boneInitialRotationRadians,
        )
        : tf.zeros([this.populationSize, 3]);
      const variable = this.track(tf.variable(
        initialRotations,
        true,
        `${tag}Bone${index}`,
      ));
      initialRotations.dispose();
      this.rotationVars.set(index, variable);
    }

    this.cameraVariables = [this.eyeVar, this.targetVar, this.upVar, this.fovVar];
    this.boneVariables = [...this.rotationVars.values()];
    this.trainableVariables = [...this.cameraVariables, ...this.boneVariables];
    this.cameraOptimizer = tf.train.adam(this.cameraLearningRate, 0.9, 0.999, 1e-7);
    this.boneOptimizer = this.boneVariables.length
      ? tf.train.adam(this.boneLearningRate, 0.9, 0.999, 1e-7)
      : null;
  }

  randomCameraSeeds(center, baseDistance, initialFovRadians) {
    const THREE = this.THREE;
    const eyes = [];
    const targets = [];
    const ups = [];
    const fovs = [];

    for (let index = 0; index < this.populationSize; index += 1) {
      const yaw = randomRange(-0.72, 0.72);
      const pitch = randomRange(-0.28, 0.28);
      const distance = baseDistance * Math.exp(randomRange(-0.28, 0.28));
      const direction = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
      const eye = center.clone().addScaledVector(direction, distance);
      const target = center.clone().add(new THREE.Vector3(
        randomRange(-0.05, 0.05) * this.modelScale,
        randomRange(-0.05, 0.05) * this.modelScale,
        randomRange(-0.05, 0.05) * this.modelScale,
      ));
      const forward = target.clone().sub(eye).normalize();
      const roll = randomRange(-0.2, 0.2);
      const up = new THREE.Vector3(0, 1, 0)
        .applyAxisAngle(forward, roll)
        .normalize();

      eyes.push([eye.x / this.modelScale, eye.y / this.modelScale, eye.z / this.modelScale]);
      targets.push([
        target.x / this.modelScale,
        target.y / this.modelScale,
        target.z / this.modelScale,
      ]);
      ups.push([up.x, up.y, up.z]);
      fovs.push(initialFovRadians + THREE.MathUtils.degToRad(randomRange(-12, 12)));
    }

    return { eyes, targets, ups, fovs };
  }

  async run(iterations = 180) {
    this.cancelled = false;

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      if (this.cancelled) break;

      const { value, grads } = this.tf.variableGrads(
        () => this.computeLoss(),
        this.trainableVariables,
      );
      value.dataSync();
      this.cameraOptimizer.applyGradients(selectGradients(grads, this.cameraVariables));
      this.boneOptimizer?.applyGradients(selectGradients(grads, this.boneVariables));
      value.dispose();
      Object.values(grads).forEach((gradient) => gradient.dispose());

      this.clampVariables();
      this.candidateLosses = this.evaluateCandidateLosses();
      this.bestIndex = indexOfMinimum(this.candidateLosses);
      this.applyCandidateToThree(this.bestIndex);
      this.renderer.render(this.scene, this.camera);

      const bestMse = this.candidateLosses[this.bestIndex];
      this.onProgress({
        iteration,
        iterations,
        bestIndex: this.bestIndex,
        bestMse,
        bestRmse: Math.sqrt(Math.max(bestMse, 0)),
        bestFovDegrees: this.camera.fov,
        activeBones: this.activeIndices.length,
        constrainedJoints: this.targets.length,
      });

      await nextAnimationFrame();
    }

    this.candidateLosses = this.evaluateCandidateLosses();
    this.bestIndex = indexOfMinimum(this.candidateLosses);
    this.applyCandidateToThree(this.bestIndex);
    this.renderer.render(this.scene, this.camera);
    return this.getResult();
  }

  computeLoss() {
    const tf = this.tf;
    return tf.tidy(() => {
      const { projected, cameraZ, forward, upGuide } = this.projectTargets();
      const targetPoints = this.targetTensor.expandDims(0);
      const dataLoss = tf.mean(tf.sum(tf.square(projected.sub(targetPoints)), 2), 1);
      const depthLoss = tf.mean(
        tf.square(tf.relu(tf.scalar(this.modelScale * 0.05).sub(cameraZ))),
        1,
      ).div(this.modelScale * this.modelScale).mul(2);
      const upParallelLoss = tf.square(tf.sum(forward.mul(upGuide), 1)).mul(0.01);
      const cameraRegularization = tf.mean(tf.square(this.eyeVar.sub(this.initialEye)), 1)
        .add(tf.mean(tf.square(this.targetVar.sub(this.initialTarget)), 1))
        .add(tf.mean(tf.square(this.upVar.sub(this.initialUp)), 1))
        .add(tf.square(this.fovVar.sub(this.initialFov)))
        .mul(0.00002);
      const rotationRegularization = this.rotationVars.size
        ? tf.addN([...this.rotationVars.values()].map((rotation) => (
          tf.mean(tf.square(rotation), 1)
        ))).div(this.rotationVars.size).mul(0.00008)
        : tf.zeros([this.populationSize]);

      return tf.sum(dataLoss
        .add(depthLoss)
        .add(upParallelLoss)
        .add(cameraRegularization)
        .add(rotationRegularization));
    });
  }

  projectTargets() {
    const tf = this.tf;
    const worldMatrices = [];
    const positionsByTarget = new Map();

    for (let index = 0; index < this.rig.length; index += 1) {
      if (!this.requiredIndices.has(index)) {
        worldMatrices.push(null);
        continue;
      }

      const entry = this.rig[index];
      const rotation = this.rotationVars.get(index);
      const local = rotation
        ? tf.matMul(entry.restRelativeTensor, rotationVectorMatrixBatch(tf, rotation))
        : entry.restRelativeTensor;
      const world = entry.parentIndex >= 0
        ? tf.matMul(worldMatrices[entry.parentIndex], local)
        : local;
      worldMatrices.push(world);

      if (this.targetIndices.has(index)) {
        const startKey = `${index}:start`;
        const endKey = `${index}:end`;

        if (this.targetKeys.has(startKey)) {
          positionsByTarget.set(startKey, world
            .slice([0, 0, 3], [this.populationSize, 3, 1])
            .reshape([this.populationSize, 3]));
        }

        if (this.targetKeys.has(endKey)) {
          positionsByTarget.set(endKey, tf.matMul(world, entry.endOffsetTensor)
            .slice([0, 0, 0], [this.populationSize, 3, 1])
            .reshape([this.populationSize, 3]));
        }
      }
    }

    const worldPoints = tf.stack(
      this.targets.map((target) => positionsByTarget.get(targetKey(target))),
      1,
    );
    const eye = this.eyeVar.mul(this.modelScale);
    const target = this.targetVar.mul(this.modelScale);
    const forward = safeNormalizeBatch(tf, target.sub(eye));
    const upGuide = safeNormalizeBatch(tf, this.upVar);
    const right = safeNormalizeBatch(tf, cross3Batch(tf, forward, upGuide));
    const up = safeNormalizeBatch(tf, cross3Batch(tf, right, forward));
    const relative = worldPoints.sub(eye.expandDims(1));
    const cameraX = tf.sum(relative.mul(right.expandDims(1)), 2);
    const cameraY = tf.sum(relative.mul(up.expandDims(1)), 2);
    const cameraZ = tf.sum(relative.mul(forward.expandDims(1)), 2);
    const safeDepth = tf.maximum(cameraZ, tf.scalar(this.modelScale * 0.01));
    const focal = tf.scalar(1).div(tf.tan(
      this.fovVar.reshape([this.populationSize, 1]).div(2),
    ));
    const aspect = tf.scalar(this.camera.aspect);
    const projectedX = cameraX.mul(focal).div(safeDepth.mul(aspect)).add(1).mul(0.5);
    const projectedY = tf.scalar(1).sub(cameraY.mul(focal).div(safeDepth)).mul(0.5);

    return {
      projected: tf.stack([projectedX, projectedY], 2),
      cameraZ,
      forward,
      upGuide,
    };
  }

  evaluateCandidateLosses() {
    const losses = this.tf.tidy(() => {
      const { projected } = this.projectTargets();
      const targetPoints = this.targetTensor.expandDims(0);
      return this.tf.mean(this.tf.sum(this.tf.square(projected.sub(targetPoints)), 2), 1);
    });
    const values = [...losses.dataSync()];
    losses.dispose();
    return values;
  }

  clampVariables() {
    const tf = this.tf;
    tf.tidy(() => {
      this.eyeVar.assign(tf.clipByValue(this.eyeVar, -20, 20));
      this.targetVar.assign(tf.clipByValue(this.targetVar, -20, 20));
      this.upVar.assign(tf.clipByValue(this.upVar, -2, 2));
      this.fovVar.assign(tf.clipByValue(
        this.fovVar,
        this.THREE.MathUtils.degToRad(12),
        this.THREE.MathUtils.degToRad(120),
      ));
      for (const variable of this.rotationVars.values()) {
        variable.assign(tf.clipByValue(variable, -Math.PI, Math.PI));
      }
    });
  }

  snapshotVariables() {
    return {
      eyes: this.eyeVar.dataSync(),
      targets: this.targetVar.dataSync(),
      ups: this.upVar.dataSync(),
      fovs: this.fovVar.dataSync(),
      rotations: new Map([...this.rotationVars].map(([index, variable]) => (
        [index, variable.dataSync()]
      ))),
    };
  }

  applyCandidateToThree(candidateIndex, snapshot = this.snapshotVariables()) {
    const THREE = this.THREE;
    const offset = candidateIndex * 3;

    for (const [index, values] of snapshot.rotations) {
      const rotation = new THREE.Vector3(values[offset], values[offset + 1], values[offset + 2]);
      const angle = rotation.length();
      const delta = new THREE.Quaternion();
      if (angle > 1e-7) {
        delta.setFromAxisAngle(rotation.multiplyScalar(1 / angle), angle);
      }
      this.rig[index].bone.quaternion.copy(this.rig[index].restQuaternion).multiply(delta);
    }
    this.scene.updateMatrixWorld(true);

    const cameraState = this.cameraState(candidateIndex, snapshot);
    this.camera.position.copy(cameraState.eye);
    this.camera.up.copy(cameraState.up);
    this.camera.fov = cameraState.fovDegrees;
    this.camera.near = Math.max(this.modelScale * 0.001, 0.001);
    this.camera.far = Math.max(
      this.modelScale * 100,
      cameraState.eye.distanceTo(cameraState.target) * 10,
    );
    this.camera.lookAt(cameraState.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  cameraState(candidateIndex, snapshot) {
    const THREE = this.THREE;
    const offset = candidateIndex * 3;
    const eye = new THREE.Vector3(
      snapshot.eyes[offset],
      snapshot.eyes[offset + 1],
      snapshot.eyes[offset + 2],
    ).multiplyScalar(this.modelScale);
    const target = new THREE.Vector3(
      snapshot.targets[offset],
      snapshot.targets[offset + 1],
      snapshot.targets[offset + 2],
    ).multiplyScalar(this.modelScale);
    const upGuide = new THREE.Vector3(
      snapshot.ups[offset],
      snapshot.ups[offset + 1],
      snapshot.ups[offset + 2],
    );
    const forward = target.clone().sub(eye).normalize();
    let right = forward.clone().cross(upGuide);
    if (right.lengthSq() < 1e-10) right = new THREE.Vector3(1, 0, 0);
    right.normalize();
    const up = right.clone().cross(forward).normalize();

    return {
      eye,
      target,
      forward,
      up,
      left: right.clone().negate(),
      fovDegrees: THREE.MathUtils.radToDeg(snapshot.fovs[candidateIndex]),
    };
  }

  getResult() {
    const snapshot = this.snapshotVariables();
    const optimizedBones = this.activeIndices.map((index) => this.rig[index].bone.name);
    const candidates = this.candidateLosses.map((loss, candidateIndex) => {
      const camera = this.cameraState(candidateIndex, snapshot);
      const rotations = {};
      const offset = candidateIndex * 3;

      for (const [index, values] of snapshot.rotations) {
        const rotationVector = [values[offset], values[offset + 1], values[offset + 2]];
        rotations[this.rig[index].bone.name] = {
          rotationVector: rotationVector.map(round),
          angleRadians: round(Math.hypot(...rotationVector)),
        };
      }

      return {
        candidate: candidateIndex + 1,
        normalizedMse: round(loss),
        normalizedRmse: round(Math.sqrt(Math.max(loss, 0))),
        camera: {
          eye: vectorJson(camera.eye),
          target: vectorJson(camera.target),
          forward: vectorJson(camera.forward),
          up: vectorJson(camera.up),
          left: vectorJson(camera.left),
          fovDegrees: round(camera.fovDegrees),
        },
        boneRotations: rotations,
      };
    });

    return {
      populationSize: this.populationSize,
      optimizedCameraParameters: ["eye", "target", "up", "fov"],
      randomCameraInitialization: true,
      randomBoneInitialization: this.boneInitialRotationRadians > 0,
      sharedZeroBoneInitialization: false,
      boneInitialRotationRadians: round(this.boneInitialRotationRadians),
      cameraLearningRate: this.cameraLearningRate,
      boneLearningRate: this.boneLearningRate,
      bestIndex: this.bestIndex,
      best: candidates[this.bestIndex],
      constrainedJoints: this.targets.map((target) => target.id),
      optimizedBones,
      candidates,
    };
  }

  isAncestor(ancestorIndex, descendantIndex) {
    let index = this.rig[descendantIndex]?.parentIndex ?? -1;
    while (index >= 0) {
      if (index === ancestorIndex) return true;
      index = this.rig[index].parentIndex;
    }
    return false;
  }

  cancel() {
    this.cancelled = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cameraOptimizer?.dispose();
    this.boneOptimizer?.dispose();
    for (const value of this.disposables) value.dispose();
    this.disposables = [];
  }

  track(value) {
    this.disposables.push(value);
    return value;
  }
}

function rotationVectorMatrixBatch(tf, vectors) {
  const populationSize = vectors.shape[0];
  const [x, y, z] = tf.unstack(vectors, 1);
  const zero = tf.zerosLike(x);
  const skew = tf.stack([
    tf.stack([zero, z.neg(), y], 1),
    tf.stack([z, zero, x.neg()], 1),
    tf.stack([y.neg(), x, zero], 1),
  ], 1);
  const thetaSquared = tf.sum(tf.square(vectors), 1);
  const theta = tf.sqrt(thetaSquared.add(1e-8));
  const a = tf.sin(theta).div(theta).reshape([populationSize, 1, 1]);
  const b = tf.scalar(1).sub(tf.cos(theta))
    .div(thetaSquared.add(1e-8))
    .reshape([populationSize, 1, 1]);
  const identity = tf.eye(3).expandDims(0).tile([populationSize, 1, 1]);
  const rotation = identity.add(skew.mul(a)).add(tf.matMul(skew, skew).mul(b));
  const upper = tf.concat([rotation, tf.zeros([populationSize, 3, 1])], 2);
  const lower = tf.tensor3d([[[0, 0, 0, 1]]]).tile([populationSize, 1, 1]);
  return tf.concat([upper, lower], 1);
}

function safeNormalizeBatch(tf, vectors) {
  return vectors.div(tf.sqrt(tf.sum(tf.square(vectors), 1, true).add(1e-8)));
}

function cross3Batch(tf, a, b) {
  const [ax, ay, az] = tf.unstack(a, 1);
  const [bx, by, bz] = tf.unstack(b, 1);
  return tf.stack([
    ay.mul(bz).sub(az.mul(by)),
    az.mul(bx).sub(ax.mul(bz)),
    ax.mul(by).sub(ay.mul(bx)),
  ], 1);
}

function matrix4BatchTensor(tf, matrix, populationSize) {
  const e = matrix.elements;
  const rows = [
    [e[0], e[4], e[8], e[12]],
    [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]],
    [e[3], e[7], e[11], e[15]],
  ];
  return tf.tensor3d(
    Array.from({ length: populationSize }, () => rows),
    [populationSize, 4, 4],
  );
}

function vector4BatchTensor(tf, vector, populationSize) {
  const rows = [[vector.x], [vector.y], [vector.z], [1]];
  return tf.tensor3d(
    Array.from({ length: populationSize }, () => rows),
    [populationSize, 4, 1],
  );
}

function selectGradients(grads, variables) {
  return Object.fromEntries(variables.map((variable) => [variable.name, grads[variable.name]]));
}

function targetKey(target) {
  return `${target.boneIndex}:${target.targetKind || "start"}`;
}

function shortBoneName(name = "") {
  return String(name)
    .replace(/^Model::/i, "")
    .replace(/^mixamorig[:_]?/i, "")
    .replace(/^mixamo[:_]?/i, "")
    .trim()
    .toLowerCase();
}

function indexOfMinimum(values) {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[bestIndex]) bestIndex = index;
  }
  return bestIndex;
}

function vectorJson(vector) {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function round(value) {
  return Number(Number(value).toFixed(6));
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
