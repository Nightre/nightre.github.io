/**
 * 健壮的极简 OBJ 加载器
 * 支持：三角形/四边形/多边形自动三角化、顶点法线(vn)、纹理坐标(vt)、正负索引
 */
export async function loadOBJ(url, material, scale = 1.0, offset = [0, 0, 0]) {
    const response = await fetch(url);
    const text = await response.text();

    const positions = [];
    const uvs = [];
    const normals = [];
    const triangles = [];

    // 辅助函数：处理 OBJ 的 1-based 索引和负索引
    const getActualIndex = (indexStr, currentLength) => {
        if (!indexStr) return -1;
        let idx = parseInt(indexStr);
        // 如果是负数，表示从当前数组末尾往前数 (OBJ 标准规范)
        return idx < 0 ? currentLength + idx : idx - 1;
    };

    const lines = text.split('\n');

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#') || line === '') continue;

        // 使用正则拆分，防止多个空格导致的解析错误
        const parts = line.split(/\s+/);
        const type = parts[0];

        if (type === 'v') {
            positions.push([
                parseFloat(parts[1]) * scale + offset[0],
                parseFloat(parts[2]) * scale + offset[1],
                parseFloat(parts[3]) * scale + offset[2]
            ]);
        } else if (type === 'vt') {
            uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
        } else if (type === 'vn') {
            normals.push([
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            ]);
        } else if (type === 'f') {
            // 解析面数据：可能是 f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 v4/vt4/vn4...
            const faceVertices = [];
            for (let i = 1; i < parts.length; i++) {
                const indices = parts[i].split('/');
                faceVertices.push({
                    vIdx: getActualIndex(indices[0], positions.length),
                    uvIdx: getActualIndex(indices[1], uvs.length),
                    nIdx: getActualIndex(indices[2], normals.length)
                });
            }

            /**
             * 三角化 (Triangulation)
             * 如果是四边形 (v0, v1, v2, v3)，拆分为 (v0, v1, v2) 和 (v0, v2, v3)
             * 这种“三角扇”法可以处理任意凸多边形
             */
            for (let i = 1; i < faceVertices.length - 1; i++) {
                const i0 = faceVertices[0];
                const i1 = faceVertices[i];
                const i2 = faceVertices[i + 1];

                // 提取位置
                const v0 = positions[i0.vIdx];
                const v1 = positions[i1.vIdx];
                const v2 = positions[i2.vIdx];

                // 提取 UV (如果有)
                const uv0 = i0.uvIdx >= 0 ? uvs[i0.uvIdx] : [0, 0];
                const uv1 = i1.uvIdx >= 0 ? uvs[i1.uvIdx] : [0, 0];
                const uv2 = i2.uvIdx >= 0 ? uvs[i2.uvIdx] : [0, 0];

                // 提取法线 (如果有)
                const n0 = i0.nIdx >= 0 ? normals[i0.nIdx] : null;
                const n1 = i1.nIdx >= 0 ? normals[i1.nIdx] : null;
                const n2 = i2.nIdx >= 0 ? normals[i2.nIdx] : null;

                triangles.push({
                    v0, v1, v2,
                    uv0, uv1, uv2,
                    n0, n1, n2,
                    mat: material
                });
            }
        }
    }

    console.log(`Successfully loaded ${triangles.length} triangles from ${url}`);
    return triangles;
}