
import { loadOBJ } from "./obj-loader.js"
import { SceneBuilder } from "./scene-builder.js"

async function createTextureArray(device, urls) {
    const bitmaps = await Promise.all(urls.map(async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        return await createImageBitmap(blob, { imageOrientation: 'flipY' });
    }));

    // 假设所有纹理大小一致，或者以第一张图为基准，实际项目中通常需要统一尺寸
    const width = bitmaps[0].width;
    const height = bitmaps[0].height;

    const texture = device.createTexture({
        size: [width, height, bitmaps.length],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    for (let i = 0; i < bitmaps.length; i++) {
        device.queue.copyExternalImageToTexture(
            { source: bitmaps[i] },
            { texture: texture, origin: [0, 0, i] },
            [width, height]
        );
    }

    return texture;
}

async function init() {
    const canvas = document.getElementById('canvas');
    if (!navigator.gpu) {
        console.error("WebGPU is not supported on this browser.");
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.error("Failed to get GPU adapter.");
        return;
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device: device,
        format: presentationFormat,
    });

    const scene = new SceneBuilder();
    scene.addCube([0, 1, -8], 2.0, {
        albedo: [1.0, 1, 1],
        emission: [0, 0, 0],
        roughness: 0.9, ior: 1.5,
        tex: 0
    });


    scene.addCube([-3, 1.5, -8], 2.0, {
        albedo: [1.0, 1, 1],
        emission: [0, 0, 0],
        roughness: 0.0, ior: 0.0,
        tex: 0
    });
    const monkeyTriangles = await loadOBJ('./stanford-bunny.obj', {
        albedo: [0.8, 0.9, 0.7],
        emission: [0, 0, 0],
        roughness: 1.0,
        ior: 0,
        tex: 1
    }, 0.03, [-5.5, 1, -9.5]);
    for (let t of monkeyTriangles) {
        scene.addTriangle(t.v0, t.v1, t.v2, [t.uv0, t.uv1, t.uv2], t.mat, [t.n0, t.n1, t.n2]);
    }

    const monkeyTriangles2 = await loadOBJ('./stanford-bunny.obj', {
        albedo: [0.8, 0.9, 0.7],
        emission: [0, 0, 0],
        roughness: 0.0,
        ior: 1.8,
        tex: 1
    }, 0.03, [-8, 1, -9.5]);
    for (let t of monkeyTriangles2) {
        scene.addTriangle(t.v0, t.v1, t.v2, [t.uv0, t.uv1, t.uv2], t.mat, [t.n0, t.n1, t.n2]);
    }

    const triangleData = scene.build();
    const { nodes, orderedIndices } = scene.buildBVH()
    const flattenedNodes = scene.flattenBVH(nodes)

    const bvhBuffer = device.createBuffer({
        label: "BVH Nodes Buffer",
        size: flattenedNodes.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const triangleIndicesBuffer = device.createBuffer({
        label: "Triangle Indices Buffer",
        size: orderedIndices.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(bvhBuffer, 0, flattenedNodes)
    device.queue.writeBuffer(triangleIndicesBuffer, 0, orderedIndices);

    // 传入图片数组 (此处假设你有 texture.jpg 和另一个图片，为了演示我只传一个数组)
    const textureUrls = ['./texture.jpg', './DefaultMaterial_baseColor.png'];
    const textureArray = await createTextureArray(device, textureUrls);

    const shaderResponse = await fetch('shader.wgsl');
    const shaderCode = await shaderResponse.text();

    const shaderModule = device.createShaderModule({
        label: 'My Shader',
        code: shaderCode,
    });

    // Uniform buffer for passing frame count and camera info to the shader
    const uniformBuffer = device.createBuffer({
        size: 80, // 20 floats (frame count + 4 vec3s and paddings)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const triangleBuffer = device.createBuffer({
        size: triangleData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });



    // Create the two Ping-Pong textures with rgba32float format
    const textureDesc = {
        size: [canvas.width, canvas.height, 1],
        format: 'rgba32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    };
    const textureA = device.createTexture({ ...textureDesc, label: 'Accumulation Texture A' });
    const textureB = device.createTexture({ ...textureDesc, label: 'Accumulation Texture B' });

    // Pipeline 1: Accumulate (calculates new frame + mixes with previous frame)
    const accumPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_accumulate',
            targets: [{ format: 'rgba32float' }],
        },
        primitive: { topology: 'triangle-list' },
    });

    // Pipeline 2: Blit (copies the accumulated result directly to the screen/canvas)
    const blitPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_blit',
            targets: [{ format: presentationFormat }],
        },
        primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });
    // Bind Groups for the Accumulation pass
    // One reads A and outputs to B (in frame logic), another reads B and outputs to A.
    const accumBGA = device.createBindGroup({
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: textureA.createView() },
            { binding: 1, resource: { buffer: uniformBuffer } },
            { binding: 2, resource: textureArray.createView({ dimension: '2d-array' }) },
            { binding: 3, resource: sampler },

            { binding: 4, resource: bvhBuffer },
            { binding: 5, resource: triangleIndicesBuffer },
            { binding: 6, resource: triangleBuffer }
        ]
    });
    const accumBGB = device.createBindGroup({
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: textureB.createView() },
            { binding: 1, resource: { buffer: uniformBuffer } },
            { binding: 2, resource: textureArray.createView({ dimension: '2d-array' }) },
            { binding: 3, resource: sampler },

            { binding: 4, resource: bvhBuffer },
            { binding: 5, resource: triangleIndicesBuffer },
            { binding: 6, resource: triangleBuffer }
        ]
    });

    // Bind Groups for the Blit pass
    const blitBGA = device.createBindGroup({
        layout: blitPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: textureA.createView() },
        ]
    });
    const blitBGB = device.createBindGroup({
        layout: blitPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: textureB.createView() },
        ]
    });

    let frameNum = 1;
    let uniformData = new Float32Array(20);

    let cameraPos = [0.0, 2.0, 5.0];
    let cameraYaw = -Math.PI / 2;
    let cameraPitch = 0.0;



    let keys = {};
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);

    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    canvas.addEventListener('mousedown', e => {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('mouseleave', () => isDragging = false);

    window.addEventListener('mousemove', e => {
        if (!isDragging) return;
        let dx = e.clientX - lastMouseX;
        let dy = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        const sensitivity = 0.005;
        cameraYaw += dx * sensitivity;
        cameraPitch -= dy * sensitivity;

        if (cameraPitch > Math.PI / 2 - 0.01) cameraPitch = Math.PI / 2 - 0.01;
        if (cameraPitch < -Math.PI / 2 + 0.01) cameraPitch = -Math.PI / 2 + 0.01;

        frameNum = 1;
    });

    let lastTime = performance.now();



    device.queue.writeBuffer(triangleBuffer, 0, triangleData);




    function frame() {
        let currentTime = performance.now();
        let deltaTime = (currentTime - lastTime) / 1000.0;
        lastTime = currentTime;

        const speed = 5.0 * deltaTime;
        let moved = false;

        const x = Math.cos(cameraPitch) * Math.cos(cameraYaw);
        const y = Math.sin(cameraPitch);
        const z = Math.cos(cameraPitch) * Math.sin(cameraYaw);

        let front = [x, y, z];
        let len = Math.sqrt(x * x + y * y + z * z);
        front = [x / len, y / len, z / len];

        let rx = -front[2];
        let rz = front[0];
        let rlen = Math.sqrt(rx * rx + rz * rz);
        let right = [rx / rlen, 0, rz / rlen];

        let ux = right[1] * front[2] - right[2] * front[1];
        let uy = right[2] * front[0] - right[0] * front[2];
        let uz = right[0] * front[1] - right[1] * front[0];
        let ulen = Math.sqrt(ux * ux + uy * uy + uz * uz);
        let up = [ux / ulen, uy / ulen, uz / ulen];

        if (keys['KeyW']) { cameraPos[0] += front[0] * speed; cameraPos[1] += front[1] * speed; cameraPos[2] += front[2] * speed; moved = true; }
        if (keys['KeyS']) { cameraPos[0] -= front[0] * speed; cameraPos[1] -= front[1] * speed; cameraPos[2] -= front[2] * speed; moved = true; }
        if (keys['KeyA']) { cameraPos[0] -= right[0] * speed; cameraPos[1] -= right[1] * speed; cameraPos[2] -= right[2] * speed; moved = true; }
        if (keys['KeyD']) { cameraPos[0] += right[0] * speed; cameraPos[1] += right[1] * speed; cameraPos[2] += right[2] * speed; moved = true; }
        if (keys['KeyQ']) { cameraPos[1] -= speed; moved = true; }
        if (keys['KeyE']) { cameraPos[1] += speed; moved = true; }

        if (moved) frameNum = 1;

        // 1. Update uniform data
        uniformData[0] = frameNum;
        uniformData[4] = cameraPos[0]; uniformData[5] = cameraPos[1]; uniformData[6] = cameraPos[2];
        uniformData[8] = front[0]; uniformData[9] = front[1]; uniformData[10] = front[2];
        uniformData[12] = right[0]; uniformData[13] = right[1]; uniformData[14] = right[2];
        uniformData[16] = up[0]; uniformData[17] = up[1]; uniformData[18] = up[2];

        device.queue.writeBuffer(uniformBuffer, 0, uniformData);


        // 2. Ping-pong logic
        // If it's an odd frame: Read A, Render to B.
        // If it's an even frame: Read B, Render to A.
        const useA_as_prev = (frameNum % 2 !== 0);

        const bgAccum = useA_as_prev ? accumBGA : accumBGB;
        const targetTexNext = useA_as_prev ? textureB : textureA;
        const bgBlit = useA_as_prev ? blitBGB : blitBGA; // Blit reads from the one we just wrote to

        const commandEncoder = device.createCommandEncoder();

        // Pass 1: Accumulation (Raytracing placeholder)
        const accumPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: targetTexNext.createView(),
                    clearValue: [0.0, 0.0, 0.0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });
        accumPass.setPipeline(accumPipeline);
        accumPass.setBindGroup(0, bgAccum);
        accumPass.draw(6);
        accumPass.end();

        // Pass 2: Presentation/Blit (Output to canvas)
        const canvasView = context.getCurrentTexture().createView();
        const blitPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: canvasView,
                    clearValue: [0.0, 0.0, 0.0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });
        blitPass.setPipeline(blitPipeline);
        blitPass.setBindGroup(0, bgBlit);
        blitPass.draw(6);
        blitPass.end();

        // Submit commands
        device.queue.submit([commandEncoder.finish()]);

        frameNum++;


        requestAnimationFrame(frame);
    }

    // Attach click event for manual stepping
    const nextFrameBtn = document.getElementById('nextFrameBtn');
    nextFrameBtn.addEventListener('click', () => {
        requestAnimationFrame(frame);
        console.log(`Rendered Frame: ${frameNum}`);
    });

    // Render the initial frame
    requestAnimationFrame(frame);
}

init();
