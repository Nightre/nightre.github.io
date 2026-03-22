class BVHNode {
    min = [0, 0, 0];
    max = [0, 0, 0];
    leftChild = 0;
    rightChild = 0;
    count = 0;
}

export class SceneBuilder {
    constructor() {
        this.triangles = [];
        this.floatPerTriangle = 44;
    }
    addTriangle(v0, v1, v2, uvs, mat, normals) {
        let n0, n1, n2;
        if (!normals || normals.length < 3) {
            const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
            const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
            const cp = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0]
            ];
            const len = Math.sqrt(cp[0] * cp[0] + cp[1] * cp[1] + cp[2] * cp[2]);
            const n = [cp[0] / len, cp[1] / len, cp[2] / len];
            n0 = n1 = n2 = n;
        } else {
            n0 = normals[0];
            n1 = normals[1];
            n2 = normals[2];
        }

        this.triangles.push({
            v: [v0, v1, v2],
            n: [n0, n1, n2],
            uvs: uvs || [[0, 0], [1, 0], [1, 1]],
            mat: mat
        });
    }

    getTriangleAABB(tri) {
        const v = tri.v;
        const eps = 0.0001;

        const min = [
            Math.min(v[0][0], v[1][0], v[2][0]) - eps,
            Math.min(v[0][1], v[1][1], v[2][1]) - eps,
            Math.min(v[0][2], v[1][2], v[2][2]) - eps
        ];
        const max = [
            Math.max(v[0][0], v[1][0], v[2][0]) + eps,
            Math.max(v[0][1], v[1][1], v[2][1]) + eps,
            Math.max(v[0][2], v[1][2], v[2][2]) + eps
        ];
        return {
            min, max, center: [
                (min[0] + max[0]) * 0.5,
                (min[1] + max[1]) * 0.5,
                (min[2] + max[2]) * 0.5
            ]
        };
    }

    mergeAABB(a, b) {
        return {
            min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
            max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])]
        };
    }

    buildBVH() {
        const objects = this.triangles.map((tri, index) => ({
            index,
            ...this.getTriangleAABB(tri)
        }));

        const nodes = [];
        const orderedIndices = new Uint32Array(this.triangles.length);
        let orderedIdxCursor = 0;

        const recursiveBuild = (objs) => {
            const node = new BVHNode();

            const currentIndex = nodes.length;
            nodes.push(node);

            let bounds = { min: objs[0].min, max: objs[0].max };
            for (let i = 1; i < objs.length; i++) {
                bounds = this.mergeAABB(bounds, objs[i]);
            }
            node.min = bounds.min;
            node.max = bounds.max;

            const n = objs.length;
            if (n <= 2) {
                node.leftChild = orderedIdxCursor;
                node.count = n;
                for (const obj of objs) {
                    orderedIndices[orderedIdxCursor++] = obj.index;
                }
            } else {
                const extent = [
                    bounds.max[0] - bounds.min[0],
                    bounds.max[1] - bounds.min[1],
                    bounds.max[2] - bounds.min[2]
                ];
                let axis = 0;
                if (extent[1] > extent[0]) axis = 1;
                if (extent[2] > extent[axis]) axis = 2;

                objs.sort((a, b) => a.center[axis] - b.center[axis]);

                const mid = Math.floor(n / 2);

                node.leftChild = recursiveBuild(objs.slice(0, mid));

                node.rightChild = recursiveBuild(objs.slice(mid));
                node.count = 0;
            }
            return currentIndex;
        };

        recursiveBuild(objects);
        return { nodes, orderedIndices };
    }

    addCube(center, sizeOrMat = 1, mat) {
        let size = sizeOrMat;
        // If second argument is an object (not an array) and mat is undefined, treat second argument as mat
        if (typeof sizeOrMat === 'object' && !Array.isArray(sizeOrMat) && mat === undefined) {
            mat = sizeOrMat;
            size = 1;
        }

        const s = Array.isArray(size) ? size : [size, size, size];
        const [rx, ry, rz] = s.map(v => v / 2);
        const [cx, cy, cz] = center;
        const v = [
            [cx - rx, cy - ry, cz - rz], [cx + rx, cy - ry, cz - rz], // 0, 1
            [cx + rx, cy + ry, cz - rz], [cx - rx, cy + ry, cz - rz], // 2, 3
            [cx - rx, cy - ry, cz + rz], [cx + rx, cy - ry, cz + rz], // 4, 5
            [cx + rx, cy + ry, cz + rz], [cx - rx, cy + ry, cz + rz]  // 6, 7
        ];
        // 定义 6 个面 (每个面由两个三角形组成)
        const faces = [
            // 原 uvs: [[0, 1], [0, 0], [1, 0], [1, 1]] -> 反转 V 轴
            { idx: [0, 3, 2, 1], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] }, // 后
            // 原 uvs: [[0, 1], [1, 1], [1, 0], [0, 0]]
            { idx: [4, 5, 6, 7], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // 前
            // 原 uvs: [[1, 1], [0, 1], [0, 0], [1, 0]]
            { idx: [0, 4, 7, 3], uvs: [[1, 0], [0, 0], [0, 1], [1, 1]] }, // 左
            // 原 uvs: [[0, 1], [0, 0], [1, 0], [1, 1]]
            { idx: [1, 2, 6, 5], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] }, // 右
            // 原 uvs: [[0, 1], [0, 0], [1, 0], [1, 1]]
            { idx: [3, 7, 6, 2], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] }, // 上
            // 原 uvs: [[0, 0], [1, 0], [1, 1], [0, 1]]
            { idx: [0, 1, 5, 4], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] }  // 下
        ];
        for (const f of faces) {
            const [a, b, c, d] = f.idx;
            const [uvA, uvB, uvC, uvD] = f.uvs;
            // 立方体的法线可以简单计算，或者传 null 让 addTriangle 自动计算
            this.addTriangle(v[a], v[b], v[c], [uvA, uvB, uvC], mat, null);
            this.addTriangle(v[a], v[c], v[d], [uvA, uvC, uvD], mat, null);
        }
    }
    flattenBVH(nodes) {
        const data = new Float32Array(nodes.length * 8);
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const off = i * 8;
            data[off + 0] = n.min[0];
            data[off + 1] = n.min[1];
            data[off + 2] = n.min[2];
            data[off + 3] = n.leftChild;

            data[off + 4] = n.max[0];
            data[off + 5] = n.max[1];
            data[off + 6] = n.max[2];
            if (n.count > 0) {
                data[off + 7] = n.count;
            } else {
                data[off + 7] = -n.rightChild;
            }
        }
        return data;
    }

    build() {
        const data = new Float32Array(this.triangles.length * this.floatPerTriangle);
        let offset = 0;
        for (const tri of this.triangles) {
            // v0, v1, v2 (每个占用 4 个 float 空间包含 padding)
            for (let i = 0; i < 3; i++) {
                data[offset++] = tri.v[i][0]; data[offset++] = tri.v[i][1]; data[offset++] = tri.v[i][2]; data[offset++] = 0.0;
            }
            // n0, n1, n2 (每个占用 4 个 float 空间包含 padding)
            for (let i = 0; i < 3; i++) {
                data[offset++] = tri.n[i][0]; data[offset++] = tri.n[i][1]; data[offset++] = tri.n[i][2]; data[offset++] = 0.0;
            }
            // uv0, uv1, uv2 (每个占用 2 个 float)
            for (let i = 0; i < 3; i++) {
                data[offset++] = tri.uvs[i][0]; data[offset++] = tri.uvs[i][1];
            }
            // Padding (为了让 Material 对齐到 16 字节)
            data[offset++] = 0.0; data[offset++] = 0.0;

            // Material.albedo
            data[offset++] = tri.mat.albedo[0]; data[offset++] = tri.mat.albedo[1]; data[offset++] = tri.mat.albedo[2]; data[offset++] = 0.0;
            // Material.emission
            data[offset++] = tri.mat.emission[0]; data[offset++] = tri.mat.emission[1]; data[offset++] = tri.mat.emission[2];
            // Material.roughness
            data[offset++] = tri.mat.roughness;
            // Material.ior
            data[offset++] = tri.mat.ior;
            // Material.tex
            data[offset++] = tri.mat.tex;

            // 补齐 Material 到 48 字节 (12 个 float)
            data[offset++] = 0.0;
            data[offset++] = 0.0;
        }
        return data;
    }
}