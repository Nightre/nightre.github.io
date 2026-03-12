struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

struct Ray {
    origin: vec3f,
    direction: vec3f,
}

struct BVHNode {
    min: vec3<f32>,
    left_child: f32,
    max: vec3<f32>,
    count_or_right: f32,
};

struct Material {
    albedo: vec3f,
    emission: vec3f,
    roughness: f32,
    ior: f32,
    tex: f32,
}

struct Sphere {
    center: vec3f,
    radius: f32,
    mat: Material,
}

struct HitRecord {
    hit: bool,
    t: f32,
    p: vec3f,
    normal: vec3f,
    mat: Material,
    uv: vec2f,
}

struct Triangle {
    v0: vec3f,      // offset 0, size 12(+4 padding)
    v1: vec3f,      // offset 16
    v2: vec3f,      // offset 32
    n0: vec3f,      // offset 48, 新增
    n1: vec3f,      // offset 64, 新增
    n2: vec3f,      // offset 80, 新增
    uv0: vec2f,     // offset 96
    uv1: vec2f,     // offset 104
    uv2: vec2f,     // offset 112
    pad: vec2f,     // offset 120, 补齐 8 字节，使 mat 对齐到 128
    mat: Material,  // offset 128
}

var<private> seed: u32;

// 初始化种子（在你的 fs_accumulate 最开头调用）
fn init_seed(pixel: vec2<u32>, frame: u32) {
    let h = pixel.x * 1973u + pixel.y * 9277u + frame * 26699u;
    seed = h | 1u;
}

// 生成 0.0 到 1.0 之间的随机浮点数
fn rand() -> f32 {
    seed = seed * 747796405u + 2891336453u;
    var result = ((seed >> ((seed >> 28u) + 4u)) ^ seed) * 277803737u;
    result = (result >> 22u) ^ result;
    return f32(result) / 4294967295.0;
}

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
    var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
        vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
    );
    
    var output : VertexOutput;
    output.position = vec4f(pos[VertexIndex], 0.0, 1.0);
    output.uv = pos[VertexIndex] * 0.5 + 0.5; // [0, 1]
    return output;
}

struct CameraUniforms {
    frame_count: f32,
    camera_pos: vec3f,
    camera_front: vec3f,
    camera_right: vec3f,
    camera_up: vec3f,
}

@group(0) @binding(0) var frame_tex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> uniforms: CameraUniforms;

@group(0) @binding(2) var tex: texture_2d_array<f32>;
@group(0) @binding(3) var texture_sampler: sampler; 

@group(0) @binding(4) var<storage, read> bvh_nodes: array<BVHNode>;
@group(0) @binding(5) var<storage, read> indices: array<u32>;
@group(0) @binding(6) var<storage, read> triangles: array<Triangle>;

fn hit_aabb(ray: Ray, inv_dir: vec3f, node: BVHNode) -> f32 {
    let t0 = (node.min - ray.origin) * inv_dir;
    let t1 = (node.max - ray.origin) * inv_dir;

    // 确保 t_min 是进入点，t_max 是离开点（处理负方向射线）
    let t_min = min(t0, t1);
    let t_max = max(t0, t1);

    // 在三个轴中取进入最晚的，离开最早的
    let t_near = max(max(t_min.x, t_min.y), t_min.z);
    let t_far  = min(min(t_max.x, t_max.y), t_max.z);

    // 判定条件：
    // 1. 进入时间 <= 离开时间
    // 2. 离开时间 > 0 (盒子在射线后面不算)
    if (t_near <= t_far && t_far > 0.0) {
        return t_near; 
    }
    
    return 1e30; // 没撞到
}

fn hit_bvh(ray: Ray, t_min:f32, t_max:f32) -> HitRecord {
    var nearest_rec: HitRecord;
    nearest_rec.hit = false;
    nearest_rec.t = 1e30;

    let inv_dir = 1.0 / ray.direction; // 提出来只算一次
    
    var stack: array<u32, 32>; // 栈，深度 32 足够处理 40 亿个三角形
    var stack_ptr: u32 = 0u;
    
    stack[stack_ptr] = 0u; // 从根节点（索引 0）开始
    stack_ptr++;

    while (stack_ptr > 0u) {
        stack_ptr--;
        let node_idx = stack[stack_ptr];
        let node = bvh_nodes[node_idx];

        // 1. 先测包围盒
        let t_box = hit_aabb(ray, inv_dir, node);
        if (t_box >= nearest_rec.t) { continue; }
        
        
        // 2. 判断是叶子还是分支
        if (node.count_or_right > 0.0) {

            let start = u32(node.left_child);
            let count = u32(node.count_or_right);
            for (var i = 0u; i < count; i++) {
                // 先从索引缓冲拿 ID，再去拿三角形数据
                let tri_idx = indices[start + i]; 
                let tri_rec = hit_triangle(ray, triangles[tri_idx], 0.001, nearest_rec.t);
                if (tri_rec.hit) {
                    nearest_rec = tri_rec;
                }
            }
        } else {
            // --- 分支节点：把左右子节点入栈 ---
            // 进阶技巧：可以先压入距离较远的盒子，后压入较近的，这样下次循环先处理近的
            stack[stack_ptr] = u32(node.left_child);
            stack_ptr++;
            stack[stack_ptr] = u32(-node.count_or_right); // 假设你用负数存右子索引
            stack_ptr++;
        }
    }

    return nearest_rec;
}

fn hit_sphere(ray:Ray, sphere:Sphere, t_min: f32, t_max: f32) -> HitRecord {
    let oc = ray.origin - sphere.center;
    let a = dot(ray.direction, ray.direction);
    let half_b = dot(oc, ray.direction);
    let c = dot(oc, oc) - sphere.radius * sphere.radius;
    
    let discriminant = half_b * half_b - a * c;

    var rec: HitRecord;
    rec.hit = false;

    if(discriminant > 0.0){
        let root = (-half_b - sqrt(discriminant)) / a;
        if (root > t_min && root < t_max) {
            rec.t = root;
            rec.p = ray.origin + ray.direction * root;
            rec.normal = (rec.p - sphere.center) / sphere.radius;
            rec.mat = sphere.mat;
            rec.hit = true;


            let phi = atan2(rec.normal.z, rec.normal.x) / (2.0 * PI) + 0.5;
            let theta = asin(rec.normal.y) / PI + 0.5;
            rec.uv = vec2f(phi, theta);

            return rec;
        }
    }
    return rec;
}

fn hit_triangle(ray: Ray, tri: Triangle, t_min: f32, t_max: f32) -> HitRecord {
    var rec: HitRecord;
    rec.hit = false;

    let e1 = tri.v1 - tri.v0;
    let e2 = tri.v2 - tri.v0;

    let pvec = cross(ray.direction, e2);

    let det = dot(e1, pvec);
    
    if (abs(det) < 0.0001) {
        return rec; // 平行
    }

    let inv_det = 1.0 / det;

    // 3. 计算从 v0 到射线起点的向量 T
    let tvec = ray.origin - tri.v0;

    // 4. 算出了重心坐标 u！
    let u = dot(tvec, pvec) * inv_det;
    if (u < 0.0 || u > 1.0) { 
        return rec; // 交点在三角形边缘外面
    }

    // 5. 准备计算 v 的中间向量 Q
    let qvec = cross(tvec, e1);

    // 6. 算出了重心坐标 v！
    let v = dot(ray.direction, qvec) * inv_det;
    if (v < 0.0 || u + v > 1.0) { 
        return rec; // 交点在三角形对角线外面
    }

    // 7. 终于算出了射线的距离 t！
    let t = dot(e2, qvec) * inv_det;

    if (t > t_min && t < t_max) {
        rec.hit = true;
        rec.t = t;
        rec.p = ray.origin + ray.direction * t;
        
        // ==========================================
        // 老师留给你的通关考验：三角形的法线该怎么算？
        // 现在我们有了顶点法线，可以使用重心坐标 (u, v) 进行插值了！
        // ==========================================
        // let interpolated_normal = normalize((1.0 - u - v) * tri.n0 + u * tri.n1 + v * tri.n2);
        
        // let outward_normal = interpolated_normal;

        let w = 1.0 - u - v;
        let smooth_normal = normalize(w * tri.n0 + u * tri.n1 + v * tri.n2);

        if (dot(ray.direction, smooth_normal) > 0.0) {
            rec.normal = -smooth_normal;
        } else {
            rec.normal = smooth_normal;
        }
        rec.mat = tri.mat;
        rec.uv = (1.0 - u - v) * tri.uv0 + u * tri.uv1 + v * tri.uv2;
    }

    return rec;
}

const PI = 3.14159265359;
fn random_unit_vector() -> vec3f {
    let r1 = rand();
    let r2 = rand();

    let z = 1.0 - 2.0 * r1;
    let r = sqrt(1.0 - z*z);

    let f = 2.0 * PI * r2;

    return vec3f(r * cos(f), r * sin(f), z);
}

@fragment
fn fs_accumulate(in : VertexOutput) -> @location(0) vec4f {
    let pos_i = vec2<i32>(floor(in.position.xy));
    let prev_color = textureLoad(frame_tex, pos_i, 0).rgb;

    let resolution = vec2f(textureDimensions(frame_tex)); 
    let aspect_ratio = resolution.x / resolution.y;
    //let uv = vec2f(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0);
    var final_color = vec3f(0.1, 0.2, 0.3); // 背景色（天空）
    init_seed(vec2<u32>(pos_i), u32(uniforms.frame_count));
    
    let pixel_size = 1.0 / resolution; 
    let jitter = vec2f(rand(), rand()) * pixel_size; 
    let jittered_uv = in.uv + jitter; 

    let uv = vec2f(jittered_uv.x * 2.0 - 1.0, jittered_uv.y * 2.0 - 1.0);

    let camera_pos = uniforms.camera_pos;
    let u = uv.x * aspect_ratio;
    let v = uv.y;
    let focal_length = 1.5;
    let ray_dir = normalize(
        uniforms.camera_front * focal_length +
        uniforms.camera_right * u +
        uniforms.camera_up * v
    );
    var ray = Ray(camera_pos, ray_dir);

    final_color = calc_light(ray);
    
    let weight = 1.0 / max(uniforms.frame_count, 1.0);
    let accumulated = mix(prev_color, final_color, weight);
    
    return vec4f(accumulated, 1.0);
}

fn hit_world(ray: Ray) -> HitRecord {
    let s1 = Sphere(vec3(0.0, 0.0, -5), 1.0, Material(vec3(1.0), vec3(0.0), 0.0, 0.9, -1));

    let s5 = Sphere(vec3(-5, 5.0, 0.0), 5.0, Material(vec3(1), vec3(0.9, 0.0, 0.9), 0.0, 0.0, -1));

    let s2 = Sphere(vec3(5, 3.0, -10.0), 4.0, Material(vec3(0.5,0.5,0.8), vec3(0), 0.1, 0.0, -1));
    let s3 = Sphere(vec3(0.0, -1001.0, 0.0), 1000.0, Material(vec3(0.2, 0.2, 0.2), vec3(0.0), 0.2, 0.0, -1));
    let s4 = Sphere(vec3(-5, 3.0, -20.0), 5.0, Material(vec3(0.2, 0.8, 0.6), vec3(0.9, 0.9, 0.9), 0., 0.0, -1));

    let ss = array<Sphere, 5>(s5, s1, s2, s3, s4);

    var nearest_rec: HitRecord;
    nearest_rec.t = 10000.0;

    for (var i: u32 = 0u; i < 5u; i += 1u) {
        let temp_rec = hit_sphere(ray, ss[i], 0.001, nearest_rec.t);
        
        if (temp_rec.t > 0.001 && temp_rec.t < nearest_rec.t) {
            nearest_rec = temp_rec;
        }
    }
    
    let temp_rec = hit_bvh(ray, 0.001, nearest_rec.t); 
    if (temp_rec.t > 0.001 && temp_rec.t < nearest_rec.t) {
        nearest_rec = temp_rec;
    }

    return nearest_rec;
}


fn calc_light(ray_in: Ray) -> vec3f { // 注意：返回值从 HitRecord 变成了最终的颜色 vec3f
    var current_ray = ray_in;
    var radiance = vec3f(0.0);
    var throughput = vec3f(1.0);
    let MAX_BOUNCES = 6; // 设定最大弹跳次数

    for (var bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        let rec = hit_world(current_ray); 

        if (rec.hit) {
            radiance += throughput * rec.mat.emission;

            var tex_color = vec3f(1.0);
            if (rec.mat.tex > -1.0) {
                tex_color = textureSampleLevel(tex, texture_sampler, rec.uv, i32(rec.mat.tex), 0.0).rgb;
            }
            let albedo = rec.mat.albedo * tex_color;
   
            // --- 材质分流逻辑开始 ---
            if (rec.mat.ior > 0.01) {
                // 【玻璃材质通道】
                var outward_normal = rec.normal;
                var refraction_ratio = 1.0 / rec.mat.ior; // 假设从空气(1.0)进入玻璃

                // 判断光线是从外面射入，还是在玻璃内部试图射出
                if (dot(current_ray.direction, rec.normal) > 0.0) {
                    outward_normal = -rec.normal; // 法线反转
                    refraction_ratio = rec.mat.ior; // 从玻璃进入空气
                }

                // 尝试算出折射方向
                let refracted = refract(current_ray.direction, outward_normal, refraction_ratio);

                // 如果 length(refracted) 是 0，说明发生了全反射 (TIR)
                if (length(refracted) < 0.001) {
                    current_ray.direction = reflect(current_ray.direction, outward_normal); // 退化为镜子
                } else {
                    current_ray.direction = refracted; // 成功穿透！
                }
                
                // 玻璃一般不怎么吸收光，为了让它通透，albedo 最好设为 vec3(1.0)
                throughput *= albedo; 
                
            } else {
                // 【普通材质通道】（你之前写的旧逻辑）
                let diffuse_dir = normalize(rec.normal + random_unit_vector());
                let specular_dir = reflect(current_ray.direction, rec.normal);
                current_ray.direction = normalize(mix(specular_dir, diffuse_dir, rec.mat.roughness));
                throughput *= albedo;
            }
            // --- 材质分流逻辑结束 ---

            // 起点依然要顺着新法线推出去一点点，防止撞自己
            // (注意：如果是折射，光线是往里走的，算出来的方向本身就会越过表面，所以偏移要用新方向来推)
            current_ray.origin = rec.p + current_ray.direction * 0.001;
        } else {
            // 5. 没击中物体，飞向了天空
            let sky_color = vec3f(0.1, 0.2, 0.3); // 你的背景色
            radiance += throughput * sky_color;
            break;
        }
    }
    return radiance;
}

@fragment
fn fs_blit(in : VertexOutput) -> @location(0) vec4f {
    let pos_i = vec2<i32>(floor(in.position.xy));
    var color = textureLoad(frame_tex, pos_i, 0).rgb;
    
    // 伽马校正（让画面更有活力）
    color = pow(color, vec3f(1.0 / 2.2));
    
    return vec4f(color, 1.0); 
}