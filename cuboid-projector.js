const EPSILON = 1e-9;
const MAXIMUM_DEPTH_RATIO = 6;

export const BOX_EDGES = {
  x: [[0, 1], [2, 3], [4, 5], [6, 7]],
  y: [[0, 2], [1, 3], [4, 6], [5, 7]],
  z: [[0, 4], [1, 5], [2, 6], [3, 7]],
};

export function buildBoxVertices(dimensions) {
  const [width, height, depth] = dimensions;
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;

  return [
    [-x, -y, -z],
    [x, -y, -z],
    [-x, y, -z],
    [x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [-x, y, z],
    [x, y, z],
  ];
}

export function cloneProjection(projection) {
  return projection.map((row) => [...row]);
}

export function projectPoint(projection, point) {
  const homogeneous = [point[0], point[1], point[2], 1];
  const denominator = dot(projection[2], homogeneous);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return null;

  return {
    x: dot(projection[0], homogeneous) / denominator,
    y: dot(projection[1], homogeneous) / denominator,
    depth: denominator,
  };
}

export function dragProjection({
  projection,
  vertices,
  vertexIndex,
  target,
  regularization = 0.006,
}) {
  const basePoints = vertices.map((vertex) => projectPoint(projection, vertex));
  if (basePoints.some((point) => !point)) return null;

  const baseUnknowns = projectionToUnknowns(projection);
  const size = baseUnknowns.length;
  const hessian = Array.from({ length: size }, () => Array(size).fill(0));
  const gradient = Array(size).fill(0);

  for (let index = 0; index < vertices.length; index += 1) {
    if (index === vertexIndex) continue;
    const equations = pointEquations(vertices[index], basePoints[index]);
    for (const equation of equations) {
      addNormalEquation(hessian, gradient, equation.row, equation.value);
    }
  }

  for (let index = 0; index < size; index += 1) {
    hessian[index][index] += regularization;
    gradient[index] += regularization * baseUnknowns[index];
  }

  const constraints = pointEquations(vertices[vertexIndex], target);
  const systemSize = size + constraints.length;
  const matrix = Array.from({ length: systemSize }, () => Array(systemSize).fill(0));
  const values = Array(systemSize).fill(0);

  for (let row = 0; row < size; row += 1) {
    values[row] = gradient[row];
    for (let column = 0; column < size; column += 1) {
      matrix[row][column] = hessian[row][column];
    }
  }

  constraints.forEach((constraint, constraintIndex) => {
    const kktIndex = size + constraintIndex;
    values[kktIndex] = constraint.value;
    for (let column = 0; column < size; column += 1) {
      matrix[column][kktIndex] = constraint.row[column];
      matrix[kktIndex][column] = constraint.row[column];
    }
  });

  const solution = solveLinearSystem(matrix, values);
  if (!solution) return null;

  const nextProjection = unknownsToProjection(solution.slice(0, size));
  return isUsableProjection(nextProjection, vertices) ? nextProjection : null;
}

export function buildClipRows(projection, vertices) {
  const depths = vertices
    .map((vertex) => projectPoint(projection, vertex)?.depth)
    .filter(Number.isFinite);
  if (depths.length !== vertices.length) return null;

  const minimumDepth = Math.max(0.002, Math.min(...depths) * 0.25);
  const maximumDepth = Math.max(minimumDepth + 1, Math.max(...depths) * 4);
  const a = (maximumDepth + minimumDepth) / (maximumDepth - minimumDepth);
  const b = (-2 * maximumDepth * minimumDepth) / (maximumDepth - minimumDepth);
  const depthRow = projection[2].map((value) => value * a);
  depthRow[3] += b;

  return [
    [...projection[0]],
    [...projection[1]],
    depthRow,
    [...projection[2]],
  ];
}

export function getVanishingPoint(projection, axis) {
  const direction = [0, 0, 0];
  direction[axis] = 1;
  const denominator = dot(projection[2].slice(0, 3), direction);
  if (Math.abs(denominator) < 1e-7) return null;

  return {
    x: dot(projection[0].slice(0, 3), direction) / denominator,
    y: dot(projection[1].slice(0, 3), direction) / denominator,
  };
}

export function lineIntersection(firstLine, secondLine) {
  const [a, b] = firstLine;
  const [c, d] = secondLine;
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-8) return null;

  const firstCross = a.x * b.y - a.y * b.x;
  const secondCross = c.x * d.y - c.y * d.x;
  return {
    x: (firstCross * (c.x - d.x) - (a.x - b.x) * secondCross) / denominator,
    y: (firstCross * (c.y - d.y) - (a.y - b.y) * secondCross) / denominator,
  };
}

export function buildProjectionFromConstruction({
  dimensions,
  aspect,
  guideLines,
  edgePoints,
  verticalVanishingPoint,
}) {
  if (guideLines.length !== 2 || edgePoints.length !== 4 || !verticalVanishingPoint) {
    return { projection: null, reason: "incomplete" };
  }

  const firstVanishing = lineIntersection(guideLines[0], guideLines[1]);
  const secondVanishing = lineIntersection(
    [edgePoints[0], edgePoints[1]],
    [edgePoints[2], edgePoints[3]],
  );
  if (!firstVanishing || !secondVanishing) {
    return { projection: null, reason: "parallel-lines" };
  }

  const vanishing = [firstVanishing, secondVanishing, verticalVanishingPoint]
    .map((point) => ({ x: point.x * aspect, y: point.y }));
  const calibration = calibrateCamera(vanishing);
  if (!calibration) return { projection: null, reason: "invalid-vanishing-points" };

  const { focalLength, principalPoint } = calibration;
  const verticalFov = (2 * Math.atan(1 / focalLength) * 180) / Math.PI;
  if (
    verticalFov < 10
    || verticalFov > 105
    || Math.abs(principalPoint.x) > Math.max(2.5, aspect * 2.5)
    || Math.abs(principalPoint.y) > 2.5
  ) {
    return { projection: null, reason: "implausible-camera" };
  }

  const [width, height, depth] = dimensions;
  const imagePoints = [edgePoints[0], edgePoints[1], edgePoints[2], edgePoints[3]]
    .map((point) => ({ x: point.x * aspect, y: point.y }));
  const worldPoints = [
    [-width / 2, -height / 2],
    [-width / 2, height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
  ];
  const homography = solveHomography(worldPoints, imagePoints);
  if (!homography) return { projection: null, reason: "invalid-face" };

  const inverseIntrinsic = (vector) => [
    (vector[0] - principalPoint.x * vector[2]) / focalLength,
    (vector[1] - principalPoint.y * vector[2]) / focalLength,
    vector[2],
  ];
  const hX = [homography[0][0], homography[1][0], homography[2][0]];
  const hY = [homography[0][1], homography[1][1], homography[2][1]];
  const hTranslation = [homography[0][2], homography[1][2], homography[2][2]];
  const rawX = inverseIntrinsic(hX);
  const rawY = inverseIntrinsic(hY);
  const scaleX = length(rawX);
  const scaleY = length(rawY);
  if (scaleX < EPSILON || scaleY < EPSILON || Math.max(scaleX, scaleY) / Math.min(scaleX, scaleY) > 5) {
    return { projection: null, reason: "invalid-proportions" };
  }

  const axisX = normalize(rawX);
  let axisY = normalize(reject(rawY, axisX));
  if (!axisX || !axisY) return { projection: null, reason: "invalid-axes" };
  if (dot(axisY, rawY) < 0) axisY = axisY.map((value) => -value);
  const axisZ = normalize(cross(axisX, axisY));
  const commonScale = Math.sqrt(scaleX * scaleY);
  const frontTranslation = inverseIntrinsic(hTranslation);
  const translation = frontTranslation.map(
    (value, index) => value + commonScale * axisZ[index] * depth / 2,
  );

  const cameraRows = Array.from({ length: 3 }, (_, row) => [
    commonScale * axisX[row],
    commonScale * axisY[row],
    commonScale * axisZ[row],
    translation[row],
  ]);
  const screenRows = [
    cameraRows[0].map((value, index) => (
      focalLength * value + principalPoint.x * cameraRows[2][index]
    )),
    cameraRows[1].map((value, index) => (
      focalLength * value + principalPoint.y * cameraRows[2][index]
    )),
    [...cameraRows[2]],
  ];
  screenRows[0] = screenRows[0].map((value) => value / aspect);

  const normalization = screenRows[2][3];
  if (!Number.isFinite(normalization) || Math.abs(normalization) < EPSILON) {
    return { projection: null, reason: "invalid-camera-position" };
  }
  const projection = screenRows.map((row) => row.map((value) => value / normalization));
  const vertices = buildBoxVertices(dimensions);
  if (!isUsableProjection(projection, vertices)) {
    return { projection: null, reason: "extreme-perspective" };
  }

  return {
    projection,
    reason: null,
    vanishingPoints: [firstVanishing, secondVanishing, verticalVanishingPoint],
    verticalFov,
    principalPoint,
  };
}

export function recoverCamera(projection) {
  const left = projection.map((row) => row.slice(0, 3));
  const translation = projection.map((row) => -row[3]);
  const position = solveLinearSystem(left, translation);
  if (!position) return null;

  const denominatorAxis = projection[2].slice(0, 3);
  const denominatorScale = length(denominatorAxis);
  if (denominatorScale < EPSILON) return null;

  const forward = normalize(denominatorAxis);
  const rawUp = reject(projection[1].slice(0, 3), forward);
  let up = normalize(rawUp);
  const rawRight = reject(
    reject(projection[0].slice(0, 3), forward),
    up,
  );
  let right = normalize(rawRight);
  if (!right || !up) return null;

  const orthogonalRight = normalize(cross(forward, up));
  if (dot(orthogonalRight, right) < 0) {
    right = orthogonalRight.map((value) => -value);
  } else {
    right = orthogonalRight;
  }
  up = normalize(cross(right, forward));

  const focalX = length(rawRight) / denominatorScale;
  const focalY = length(rawUp) / denominatorScale;
  const verticalFov = focalY > EPSILON
    ? (2 * Math.atan(1 / focalY) * 180) / Math.PI
    : null;

  return {
    position,
    right,
    up,
    forward,
    verticalFov,
    focalX,
    focalY,
  };
}

function pointEquations(vertex, point) {
  const [x, y, z] = vertex;
  const homogeneous = [x, y, z, 1];
  const xRow = Array(11).fill(0);
  const yRow = Array(11).fill(0);

  for (let index = 0; index < 4; index += 1) {
    xRow[index] = homogeneous[index];
    yRow[4 + index] = homogeneous[index];
  }

  xRow[8] = -point.x * x;
  xRow[9] = -point.x * y;
  xRow[10] = -point.x * z;
  yRow[8] = -point.y * x;
  yRow[9] = -point.y * y;
  yRow[10] = -point.y * z;

  return [
    { row: xRow, value: point.x },
    { row: yRow, value: point.y },
  ];
}

function calibrateCamera(vanishingPoints) {
  const pairs = [[0, 1], [0, 2], [1, 2]];
  const matrix = [];
  const values = [];

  for (const [firstIndex, secondIndex] of pairs) {
    const first = vanishingPoints[firstIndex];
    const second = vanishingPoints[secondIndex];
    matrix.push([
      -(first.x + second.x),
      -(first.y + second.y),
      1,
    ]);
    values.push(-(first.x * second.x + first.y * second.y));
  }

  const solution = solveLinearSystem(matrix, values);
  if (!solution) return null;
  const [principalX, principalY, squaredNorm] = solution;
  const focalSquared = squaredNorm - principalX ** 2 - principalY ** 2;
  if (!Number.isFinite(focalSquared) || focalSquared <= 1e-5) return null;

  return {
    focalLength: Math.sqrt(focalSquared),
    principalPoint: { x: principalX, y: principalY },
  };
}

function solveHomography(worldPoints, imagePoints) {
  const matrix = [];
  const values = [];

  for (let index = 0; index < worldPoints.length; index += 1) {
    const [x, y] = worldPoints[index];
    const { x: u, y: v } = imagePoints[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }

  const solution = solveLinearSystem(matrix, values);
  if (!solution) return null;
  return [
    solution.slice(0, 3),
    solution.slice(3, 6),
    [solution[6], solution[7], 1],
  ];
}

function addNormalEquation(matrix, values, row, value) {
  for (let i = 0; i < row.length; i += 1) {
    values[i] += row[i] * value;
    for (let j = 0; j < row.length; j += 1) {
      matrix[i][j] += row[i] * row[j];
    }
  }
}

function projectionToUnknowns(projection) {
  return [
    ...projection[0],
    ...projection[1],
    projection[2][0],
    projection[2][1],
    projection[2][2],
  ];
}

function unknownsToProjection(unknowns) {
  return [
    unknowns.slice(0, 4),
    unknowns.slice(4, 8),
    [...unknowns.slice(8, 11), 1],
  ];
}

function isUsableProjection(projection, vertices) {
  if (projection.flat().some((value) => !Number.isFinite(value) || Math.abs(value) > 1e5)) {
    return false;
  }

  const depths = [];
  for (const vertex of vertices) {
    const point = projectPoint(projection, vertex);
    if (!point || point.depth <= 0.04 || Math.abs(point.x) > 30 || Math.abs(point.y) > 30) {
      return false;
    }
    depths.push(point.depth);
  }

  return Math.max(...depths) / Math.min(...depths) <= MAXIMUM_DEPTH_RATIO;
}

function solveLinearSystem(sourceMatrix, sourceValues) {
  const size = sourceValues.length;
  const matrix = sourceMatrix.map((row, index) => [...row, sourceValues[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(matrix[pivotRow][column]) < 1e-11) return null;
    [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];

    const pivot = matrix[column][column];
    for (let index = column; index <= size; index += 1) {
      matrix[column][index] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (Math.abs(factor) < EPSILON) continue;
      for (let index = column; index <= size; index += 1) {
        matrix[row][index] -= factor * matrix[column][index];
      }
    }
  }

  const result = matrix.map((row) => row[size]);
  return result.every(Number.isFinite) ? result : null;
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector) {
  const magnitude = length(vector);
  return magnitude > EPSILON ? vector.map((value) => value / magnitude) : null;
}

function reject(vector, axis) {
  if (!axis) return vector;
  const amount = dot(vector, axis);
  return vector.map((value, index) => value - amount * axis[index]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}
