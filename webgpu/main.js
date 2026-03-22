import { loadOBJ } from "./obj-loader.js";
import { SceneBuilder } from "./scene-builder.js";

async function createTextureArray(device, urls) {
    const bitmaps = await Promise.all(urls.map(async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        return await createImageBitmap(blob, { imageOrientation: 'flipY' });
    }));

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

class WebGPUThreeDApp {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);

        this.frameNum = 1;
        this.lastTime = performance.now();
        this.uniformData = new Float32Array(36);

        this.camera = {
            pos: [0.0, 2.0, 5.0],
            yaw: -Math.PI / 2,
            pitch: 0.0
        };

        this.input = {
            keys: {},
            isDragging: false,
            lastMouseX: 0,
            lastMouseY: 0
        };

        this.isRunning = true;

        this.prevCameraState = {
            pos: [0, 0, 0], front: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0]
        };

        this.isCollectingData = true; // 开启数据采集模式
        this.dataIndex = 0;
        this.maxDataCount = 1000;
        this.targetSPP = 500; // 累积 100 帧作为 GT
        this.isExtracting = false; // 防止重复提取的锁

    }
    async readTexture(device, texture, width, height) {
        const bytesPerPixel = 16;
        const unpaddedBytesPerRow = width * bytesPerPixel;
        const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
        const bufferSize = bytesPerRow * height;

        const readBuffer = device.createBuffer({ size: bufferSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        const commandEncoder = device.createCommandEncoder();
        commandEncoder.copyTextureToBuffer(
            { texture: texture },
            { buffer: readBuffer, bytesPerRow: bytesPerRow, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 }
        );
        device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = readBuffer.getMappedRange();

        const paddedArray = new Float32Array(arrayBuffer);
        const resultData = new Float32Array(width * height * 4);

        for (let y = 0; y < height; y++) {
            const srcOffset = y * (bytesPerRow / 4);
            const dstOffset = y * (unpaddedBytesPerRow / 4);
            resultData.set(paddedArray.subarray(srcOffset, srcOffset + (unpaddedBytesPerRow / 4)), dstOffset);
        }
        readBuffer.unmap();
        return resultData;
    }

    // 数据组装与发送
    async extractAndSendData() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const device = this.device;

        // 当前 targetTexNext 就是累积了 100 帧的 GT
        const gtTexture = (this.frameNum % 2 !== 0) ? this.textureA : this.textureB;

        // 并行从 GPU 拉取数据
        const [gtData, noisyData, normDepthData, albedoRoughData, velocityData] = await Promise.all([
            this.readTexture(device, gtTexture, w, h),
            this.readTexture(device, this.texNoisyLight, w, h),
            this.readTexture(device, this.texNormalDepth, w, h),
            this.readTexture(device, this.texAlbedoRough, w, h),
            this.readTexture(device, this.texVelocity, w, h)
        ]);

        const pixelCount = w * h;

        // 构造 X.bin (11个特征通道) 和 Y.bin (3个颜色通道)
        const xData = new Float32Array(pixelCount * 11);
        const yData = new Float32Array(pixelCount * 3);

        for (let i = 0; i < pixelCount; i++) {
            let b4 = i * 4;
            let bx = i * 13;
            let by = i * 3;

            // 填充 X Tensor [NoisyRGB, NormXYZ, Depth, AlbedoRGB, Roughness]
            xData[bx + 0] = noisyData[b4 + 0]; xData[bx + 1] = noisyData[b4 + 1]; xData[bx + 2] = noisyData[b4 + 2];
            xData[bx + 3] = normDepthData[b4 + 0]; xData[bx + 4] = normDepthData[b4 + 1]; xData[bx + 5] = normDepthData[b4 + 2];
            xData[bx + 6] = normDepthData[b4 + 3]; // Depth
            xData[bx + 7] = albedoRoughData[b4 + 0]; xData[bx + 8] = albedoRoughData[b4 + 1]; xData[bx + 9] = albedoRoughData[b4 + 2];
            xData[bx + 10] = albedoRoughData[b4 + 3]; // Roughness
            xData[bx + 11] = velocityData[b4 + 0];
            xData[bx + 12] = velocityData[b4 + 1];
            // 填充 Y Tensor [GT RGB]
            yData[by + 0] = gtData[b4 + 0]; yData[by + 1] = gtData[b4 + 1]; yData[by + 2] = gtData[b4 + 2];
        }

        // 将二进制直接 POST 到本地服务器
        await fetch('http://localhost:3000/save', {
            method: 'POST',
            headers: { 'File-Name': `x_${this.dataIndex.toString().padStart(4, '0')}.bin` },
            body: xData.buffer
        });

        await fetch('http://localhost:3000/save', {
            method: 'POST',
            headers: { 'File-Name': `y_${this.dataIndex.toString().padStart(4, '0')}.bin` },
            body: yData.buffer
        });
    }

    async run() {
        await this.initWebGPU();
        if (!this.device) return;

        await this.buildScene();

        await this.setupPipelines();

        this.setupInput();

        requestAnimationFrame(() => this.render());
    }

    async initWebGPU() {
        if (!navigator.gpu) {
            console.error("WebGPU is not supported on this browser.");
            return;
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("Failed to get GPU adapter.");
            return;
        }
        this.device = await adapter.requestDevice({
            requiredLimits: {
                maxColorAttachmentBytesPerSample: 128
            }
        });
        this.context = this.canvas.getContext('webgpu');
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
        });
    }

    async buildScene() {
        const scene = new SceneBuilder();

        scene.addCube([0, 1, -8], 2.0, { albedo: [1.0, 1, 1], emission: [0, 0, 0], roughness: 0.9, ior: 1.5, tex: -1 });
        scene.addCube([-3, 1.5, -8], 2.0, { albedo: [1.0, 1, 1], emission: [0, 0, 0], roughness: 0.0, ior: 0.0, tex: -1 });

        scene.addCube([-3, 5, -8], [2.0, 1.0, 2.0], { albedo: [1.0, 1, 1], emission: [20, 20, 20], roughness: 1.0, ior: 0.0, tex: 0 });
        scene.addCube([-3, 1.5, -11.5], 2.0, { albedo: [1.0, 1, 1], emission: [0, 0, 0], roughness: 0.8, ior: 0.0, tex: 0 });

        const monkeyTriangles = await loadOBJ('./stanford-bunny.obj', { albedo: [0.8, 0.9, 0.7], emission: [0, 0, 0], roughness: 1.0, ior: 0, tex: 1 }, 0.03, [-5.5, 1, -9.5]);
        for (let t of monkeyTriangles) scene.addTriangle(t.v0, t.v1, t.v2, [t.uv0, t.uv1, t.uv2], t.mat, [t.n0, t.n1, t.n2]);

        const monkeyTriangles2 = await loadOBJ('./stanford-bunny.obj', { albedo: [0.8, 0.9, 0.7], emission: [0, 0, 0], roughness: 0.0, ior: 1.8, tex: 1 }, 0.03, [-8.5, 1, -9.5]);
        for (let t of monkeyTriangles2) scene.addTriangle(t.v0, t.v1, t.v2, [t.uv0, t.uv1, t.uv2], t.mat, [t.n0, t.n1, t.n2]);

        const monkeyTriangles3 = await loadOBJ('./stanford-bunny.obj', { albedo: [0.8, 0.9, 0.7], emission: [0, 0, 0], roughness: 0.0, ior: 0, tex: 1 }, 0.03, [-6, 1, -12]);
        for (let t of monkeyTriangles3) scene.addTriangle(t.v0, t.v1, t.v2, [t.uv0, t.uv1, t.uv2], t.mat, [t.n0, t.n1, t.n2]);


        this.triangleData = scene.build();
        const { nodes, orderedIndices } = scene.buildBVH();
        this.flattenedNodes = scene.flattenBVH(nodes);
        this.orderedIndices = orderedIndices;
    }

    async setupPipelines() {
        const { device } = this;

        this.bvhBuffer = device.createBuffer({ label: "BVH Nodes", size: this.flattenedNodes.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.triangleIndicesBuffer = device.createBuffer({ label: "Triangle Indices", size: this.orderedIndices.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.triangleBuffer = device.createBuffer({ size: this.triangleData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.uniformBuffer = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        device.queue.writeBuffer(this.bvhBuffer, 0, this.flattenedNodes);
        device.queue.writeBuffer(this.triangleIndicesBuffer, 0, this.orderedIndices);
        device.queue.writeBuffer(this.triangleBuffer, 0, this.triangleData);

        const textureUrls = ['./texture.jpg', './DefaultMaterial_baseColor.png'];
        const textureArray = await createTextureArray(device, textureUrls);
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        const shaderResponse = await fetch('shader.wgsl');
        const shaderCode = await shaderResponse.text();
        const shaderModule = device.createShaderModule({ label: 'My Shader', code: shaderCode });

        const textureDesc = { size: [this.canvas.width, this.canvas.height, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC };
        this.textureA = device.createTexture({ ...textureDesc, label: 'Accum Texture A' });
        this.textureB = device.createTexture({ ...textureDesc, label: 'Accum Texture B' });

        this.accumPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_accumulate',
                // 必须显式声明 4 个输出目标，且格式必须与贴图一致 👇
                targets: [
                    { format: 'rgba32float' }, // @location(0): accum_color
                    { format: 'rgba32float' }, // @location(1): noisy_light
                    { format: 'rgba32float' }, // @location(2): normal_depth
                    { format: 'rgba32float' },  // @location(3): albedo_roughness
                    { format: 'rgba32float' }
                ]
            },
            primitive: { topology: 'triangle-list' },
        });

        this.blitPipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_blit', targets: [{ format: this.presentationFormat }] },
            primitive: { topology: 'triangle-list' },
        });

        const createAccumBG = (targetTex) => device.createBindGroup({
            layout: this.accumPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: targetTex.createView() },
                { binding: 1, resource: { buffer: this.uniformBuffer } },
                { binding: 2, resource: textureArray.createView({ dimension: '2d-array' }) },
                { binding: 3, resource: sampler },
                { binding: 4, resource: this.bvhBuffer },
                { binding: 5, resource: this.triangleIndicesBuffer },
                { binding: 6, resource: this.triangleBuffer }
            ]
        });

        this.accumBGA = createAccumBG(this.textureA);
        this.accumBGB = createAccumBG(this.textureB);

        this.blitBGA = device.createBindGroup({ layout: this.blitPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.textureA.createView() }] });
        this.blitBGB = device.createBindGroup({ layout: this.blitPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.textureB.createView() }] });

        this.texNoisyLight = device.createTexture({ ...textureDesc });
        this.texNormalDepth = device.createTexture({ ...textureDesc });
        this.texAlbedoRough = device.createTexture({ ...textureDesc });
        this.texVelocity = device.createTexture({ ...textureDesc });

        // Pre-create views to avoid memory leaks
        this.viewA = this.textureA.createView();
        this.viewB = this.textureB.createView();
        this.viewNoisy = this.texNoisyLight.createView();
        this.viewNormDepth = this.texNormalDepth.createView();
        this.viewAlbedoRough = this.texAlbedoRough.createView();
        this.viewVelocity = this.texVelocity.createView();
    }
    randomizeCamera() {
        // 1. 随机当前位置
        this.camera.pos[0] = (Math.random() - 0.5) * 8.0 - 8.0;
        this.camera.pos[1] = 1.0 + Math.random() * 3.0;
        this.camera.pos[2] = -5.0 + (Math.random() - 0.5) * 4.0;
        this.camera.yaw = (Math.random() - 0.5) * Math.PI;
        this.camera.pitch = (Math.random() - 0.5) * 0.5;

        // 2. 强行伪造一个“前一帧”的微小位移，这样才能产生 Velocity！
        const motionSpeed = 0.1; // 模拟上一帧到这一帧的移动量
        this.prevCameraState.pos = [
            this.camera.pos[0] + (Math.random() - 0.5) * motionSpeed,
            this.camera.pos[1] + (Math.random() - 0.5) * motionSpeed,
            this.camera.pos[2] + (Math.random() - 0.5) * motionSpeed
        ];

        // 3. 同时更新前一帧的姿态，避免为 0 导致投影矩阵失效
        const x = Math.cos(this.camera.pitch) * Math.cos(this.camera.yaw);
        const y = Math.sin(this.camera.pitch);
        const z = Math.cos(this.camera.pitch) * Math.sin(this.camera.yaw);
        const len = Math.sqrt(x * x + y * y + z * z);
        const front = [x / len, y / len, z / len];
        const rx = -front[2];
        const rz = front[0];
        const rlen = Math.sqrt(rx * rx + rz * rz);
        const right = [rx / rlen, 0, rz / rlen];
        const ux = right[1] * front[2] - right[2] * front[1];
        const uy = right[2] * front[0] - right[0] * front[2];
        const uz = right[0] * front[1] - right[1] * front[0];
        const ulen = Math.sqrt(ux * ux + uy * uy + uz * uz);
        const up = [ux / ulen, uy / ulen, uz / ulen];

        this.prevCameraState.front = front;
        this.prevCameraState.right = right;
        this.prevCameraState.up = up;
    }
    setupInput() {
        window.addEventListener('keydown', e => this.input.keys[e.code] = true);
        window.addEventListener('keyup', e => this.input.keys[e.code] = false);

        this.canvas.addEventListener('mousedown', e => {
            this.input.isDragging = true;
            this.input.lastMouseX = e.clientX;
            this.input.lastMouseY = e.clientY;
        });

        window.addEventListener('mouseup', () => this.input.isDragging = false);
        window.addEventListener('mouseleave', () => this.input.isDragging = false);

        window.addEventListener('mousemove', e => {
            if (!this.input.isDragging) return;
            let dx = e.clientX - this.input.lastMouseX;
            let dy = e.clientY - this.input.lastMouseY;
            this.input.lastMouseX = e.clientX;
            this.input.lastMouseY = e.clientY;

            const sensitivity = 0.005;
            this.camera.yaw += dx * sensitivity;
            this.camera.pitch -= dy * sensitivity;

            this.camera.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.camera.pitch));
            this.frameNum = 1;
        });

        const nextFrameBtn = document.getElementById('nextFrameBtn');
        if (nextFrameBtn) {
            nextFrameBtn.addEventListener('click', () => {
                console.log(`Rendered Frame: ${this.frameNum}`);
            });
        }
    }

    updateCamera(deltaTime) {
        const pos = this.camera.pos;


        const speed = 5.0 * deltaTime;
        let moved = false;

        const x = Math.cos(this.camera.pitch) * Math.cos(this.camera.yaw);
        const y = Math.sin(this.camera.pitch);
        const z = Math.cos(this.camera.pitch) * Math.sin(this.camera.yaw);

        let len = Math.sqrt(x * x + y * y + z * z);
        let front = [x / len, y / len, z / len];

        let rx = -front[2];
        let rz = front[0];
        let rlen = Math.sqrt(rx * rx + rz * rz);
        let right = [rx / rlen, 0, rz / rlen];

        let ux = right[1] * front[2] - right[2] * front[1];
        let uy = right[2] * front[0] - right[0] * front[2];
        let uz = right[0] * front[1] - right[1] * front[0];
        let ulen = Math.sqrt(ux * ux + uy * uy + uz * uz);
        let up = [ux / ulen, uy / ulen, uz / ulen];

        const keys = this.input.keys;

        if (keys['KeyW']) { pos[0] += front[0] * speed; pos[1] += front[1] * speed; pos[2] += front[2] * speed; moved = true; }
        if (keys['KeyS']) { pos[0] -= front[0] * speed; pos[1] -= front[1] * speed; pos[2] -= front[2] * speed; moved = true; }
        if (keys['KeyA']) { pos[0] -= right[0] * speed; pos[1] -= right[1] * speed; pos[2] -= right[2] * speed; moved = true; }
        if (keys['KeyD']) { pos[0] += right[0] * speed; pos[1] += right[1] * speed; pos[2] += right[2] * speed; moved = true; }
        if (keys['KeyQ']) { pos[1] -= speed; moved = true; }
        if (keys['KeyE']) { pos[1] += speed; moved = true; }

        if (moved) this.frameNum = 1;

        this.uniformData[0] = this.frameNum;
        this.uniformData[4] = pos[0]; this.uniformData[5] = pos[1]; this.uniformData[6] = pos[2];
        this.uniformData[8] = front[0]; this.uniformData[9] = front[1]; this.uniformData[10] = front[2];
        this.uniformData[12] = right[0]; this.uniformData[13] = right[1]; this.uniformData[14] = right[2];
        this.uniformData[16] = up[0]; this.uniformData[17] = up[1]; this.uniformData[18] = up[2];

        this.uniformData[20] = this.prevCameraState.pos[0];
        this.uniformData[21] = this.prevCameraState.pos[1];
        this.uniformData[22] = this.prevCameraState.pos[2];

        this.uniformData[24] = this.prevCameraState.front[0];
        this.uniformData[25] = this.prevCameraState.front[1];
        this.uniformData[26] = this.prevCameraState.front[2];

        this.uniformData[28] = this.prevCameraState.right[0];
        this.uniformData[29] = this.prevCameraState.right[1];
        this.uniformData[30] = this.prevCameraState.right[2];

        this.uniformData[32] = this.prevCameraState.up[0];
        this.uniformData[33] = this.prevCameraState.up[1];
        this.uniformData[34] = this.prevCameraState.up[2];

        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    }

    render() {
        if (!this.isRunning) return;

        let currentTime = performance.now();
        let deltaTime = (currentTime - this.lastTime) / 1000.0;
        this.lastTime = currentTime;

        if (this.isCollectingData && !this.isExtracting) {
            // 如果到达了 100 帧，开始提取数据！
            if (this.frameNum >= this.targetSPP) {
                this.isExtracting = true;
                this.extractAndSendData().then(() => {
                    this.dataIndex++;
                    console.log(`已完成 ${this.dataIndex} / ${this.maxDataCount}`);

                    if (this.dataIndex >= this.maxDataCount) {
                        this.isCollectingData = false;
                        console.log("数据采集结束！");
                    } else {
                        // 随机微调相机位置，准备渲染下一张
                        this.randomizeCamera();
                        this.frameNum = 1;
                        this.isExtracting = false;
                        requestAnimationFrame(() => this.render());
                    }
                });
                return; // 提取时暂停渲染一帧
            }
        }


        this.updateCamera(deltaTime);

        let lastBgBlit;

        const ACCUM_COUNT = 10; // 把 500 改成 10，保证 GPU 不会超时罢工
        for (let index = 0; index < ACCUM_COUNT; index++) {
            if (this.frameNum >= this.targetSPP) break; // 防止多跑

            this.uniformData[0] = this.frameNum;
            this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

            const useA_as_prev = (this.frameNum % 2 !== 0);
            const bgAccum = useA_as_prev ? this.accumBGA : this.accumBGB;
            const viewNext = useA_as_prev ? this.viewB : this.viewA;

            lastBgBlit = useA_as_prev ? this.blitBGB : this.blitBGA;

            // 第一帧必须是 'clear'，后续帧才是 'load' 累加
            const op = (this.frameNum === 1) ? 'clear' : 'load';

            const commandEncoder = this.device.createCommandEncoder();

            const accumPass = commandEncoder.beginRenderPass({
                colorAttachments: [
                    { view: viewNext, loadOp: op, clearValue: [0, 0, 0, 0], storeOp: 'store' },
                    { view: this.viewNoisy, loadOp: op, clearValue: [0, 0, 0, 0], storeOp: 'store' },
                    { view: this.viewNormDepth, loadOp: op, clearValue: [0, 0, 0, 0], storeOp: 'store' },
                    { view: this.viewAlbedoRough, loadOp: op, clearValue: [0, 0, 0, 0], storeOp: 'store' },
                    { view: this.viewVelocity, loadOp: op, clearValue: [0, 0, 0, 0], storeOp: 'store' }
                ],
            });
            accumPass.setPipeline(this.accumPipeline);
            accumPass.setBindGroup(0, bgAccum);
            accumPass.draw(6);
            accumPass.end();

            this.device.queue.submit([commandEncoder.finish()]);

            this.frameNum++;
        }

        const blitCommandEncoder = this.device.createCommandEncoder();
        const canvasView = this.context.getCurrentTexture().createView();

        const blitPass = blitCommandEncoder.beginRenderPass({
            colorAttachments: [{
                view: canvasView,
                clearValue: [0.0, 0.0, 0.0, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        blitPass.setPipeline(this.blitPipeline);

        blitPass.setBindGroup(0, lastBgBlit);
        blitPass.draw(6);
        blitPass.end();

        this.device.queue.submit([blitCommandEncoder.finish()]);

        requestAnimationFrame(() => this.render());
    }
}

const app = new WebGPUThreeDApp('canvas');
app.run();