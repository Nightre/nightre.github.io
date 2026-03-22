// 传给片段着色器的数据（只需要位置和 UV）
struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

// 片段着色器输出到 5 张贴图 (MRT) 的结构
struct FragmentOutput {
    @location(0) accum_color : vec4f,       // 累积颜色 (Ground Truth)
    @location(1) noisy_light : vec4f,       // 1spp 当前帧【纯光照】(Input X)
    @location(2) normal_depth : vec4f,      // 法线 XYZ + 深度 W (Input X)
    @location(3) albedo_roughness : vec4f,  // 反照率 RGB + 粗糙度 W (Input X)
    @location(4) velocity : vec4f,          // 运动向量 XY (Input X) - 新增
};

// 增加一个结构体，用于让 calc_light 返回第一跳的 G-Buffer 数据
struct PathTraceResult {
    radiance: vec3f,       // 最终追踪得到的光亮度
    first_normal: vec3f,   // 屏幕空间法线
    first_depth: f32,      // 深度
    first_albedo: vec3f,   // 反照率（Base Color）
    first_roughness: f32,  // 粗糙度
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
    v0: vec3f,      
    v1: vec3f,      
    v2: vec3f,      
    n0: vec3f,      
    n1: vec3f,      
    n2: vec3f,      
    uv0: vec2f,     
    uv1: vec2f,     
    uv2: vec2f,     
    pad: vec2f,     // offset 120, 补齐 8 字节，使 mat 对齐到 128
    mat: Material,  
}

var<private> seed: u32;

// 初始化种子
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

// 扩充后的 Uniforms 结构体
struct CameraUniforms {
    frame_count: f32,
    camera_pos: vec3f,
    camera_front: vec3f,
    camera_right: vec3f,
    camera_up: vec3f,
    // WGSL 中 vec3f 自动按照 16 字节对齐，所以下面的内存分布完全等价于 JS 端的设定
    prev_camera_pos: vec3f,
    prev_camera_front: vec3f,
    prev_camera_right: vec3f,
    prev_camera_up: vec3f,
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

    let t_min = min(t0, t1);
    let t_max = max(t0, t1);

    let t_near = max(max(t_min.x, t_min.y), t_min.z);
    let t_far  = min(min(t_max.x, t_max.y), t_max.z);

    if (t_near <= t_far && t_far > 0.0) {
        return t_near; 
    }
    return 1e30; 
}

fn hit_bvh(ray: Ray, t_min:f32, t_max:f32) -> HitRecord {
    var nearest_rec: HitRecord;
    nearest_rec.hit = false;
    nearest_rec.t = 1e30;

    let inv_dir = 1.0 / ray.direction; 
    
    var stack: array<u32, 32>; 
    var stack_ptr: u32 = 0u;
    
    stack[stack_ptr] = 0u;
    stack_ptr++;

    while (stack_ptr > 0u) {
        stack_ptr--;
        let node_idx = stack[stack_ptr];
        let node = bvh_nodes[node_idx];

        let t_box = hit_aabb(ray, inv_dir, node);
        if (t_box >= nearest_rec.t) { continue; }
        
        if (node.count_or_right > 0.0) {
            let start = u32(node.left_child);
            let count = u32(node.count_or_right);
            for (var i = 0u; i < count; i++) {
                let tri_idx = indices[start + i]; 
                let tri_rec = hit_triangle(ray, triangles[tri_idx], 0.001, nearest_rec.t);
                if (tri_rec.hit) {
                    nearest_rec = tri_rec;
                }
            }
        } else {
            stack[stack_ptr] = u32(node.left_child);
            stack_ptr++;
            stack[stack_ptr] = u32(-node.count_or_right);
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
        return rec;
    }

    let inv_det = 1.0 / det;
    let tvec = ray.origin - tri.v0;

    let u = dot(tvec, pvec) * inv_det;
    if (u < 0.0 || u > 1.0) { 
        return rec;
    }

    let qvec = cross(tvec, e1);
    let v = dot(ray.direction, qvec) * inv_det;
    if (v < 0.0 || u + v > 1.0) { 
        return rec;
    }

    let t = dot(e2, qvec) * inv_det;

    if (t > t_min && t < t_max) {
        rec.hit = true;
        rec.t = t;
        rec.p = ray.origin + ray.direction * t;
        
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
fn fs_accumulate(in : VertexOutput) -> FragmentOutput  {
    let pos_i = vec2<i32>(floor(in.position.xy));
    let prev_color = textureLoad(frame_tex, pos_i, 0).rgb;

    let resolution = vec2f(textureDimensions(frame_tex)); 
    let aspect_ratio = resolution.x / resolution.y;
    
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

    let trace_result = calc_light(ray);
    
    let weight = 1.0 / max(uniforms.frame_count, 1.0);
    let accumulated = mix(prev_color, trace_result.radiance, weight);
    
    var out: FragmentOutput;
    out.accum_color = vec4f(accumulated, 1.0);
    
    // 只在第 1 帧的时候写入特征
    if (uniforms.frame_count < 1.5) {
        let pure_lighting = trace_result.radiance / max(trace_result.first_albedo, vec3f(0.001));
        
        out.noisy_light = vec4f(pure_lighting, 1.0);
        out.normal_depth = vec4f(trace_result.first_normal, trace_result.first_depth);
        out.albedo_roughness = vec4f(trace_result.first_albedo, trace_result.first_roughness);

        // --- 计算 Motion Vector (Velocity) ---
        var velocity = vec2f(0.0);
        
        // 确保击中了物体（深度小于 10000），如果是天空盒我们给 0
        if (trace_result.first_depth < 10000.0) {
            // 反求第一跳交点的世界坐标
            let world_pos = camera_pos + ray_dir * trace_result.first_depth;
            
            // 投影到上一帧相机的坐标系
            let to_p = world_pos - uniforms.prev_camera_pos;
            let z = dot(to_p, uniforms.prev_camera_front);
            
            if (z > 0.0) {
                // 完全逆推射线生成的公式
                let prev_u = dot(to_p, uniforms.prev_camera_right) * focal_length / z;
                let prev_v = dot(to_p, uniforms.prev_camera_up) * focal_length / z;
                
                // 去除 aspect_ratio 的影响，转回 NDC 坐标 [-1, 1]
                let prev_ndc_x = prev_u / aspect_ratio;
                let prev_ndc_y = prev_v;
                
                // 转回 0 到 1 的屏幕 UV 空间
                let prev_uv = vec2f(prev_ndc_x * 0.5 + 0.5, prev_ndc_y * 0.5 + 0.5);
                
                // 运动向量 = 当前屏幕坐标 - 上一帧屏幕坐标
                // 这里用无 jitter 的 in.uv 保证 Motion Vectors 干净平滑
                velocity = in.uv - prev_uv;
            }
        }
        out.velocity = vec4f(velocity, 0.0, 1.0);
        // ------------------------------------

    } else {
        out.noisy_light = vec4f(0.0);
        out.normal_depth = vec4f(0.0);
        out.albedo_roughness = vec4f(0.0);
        out.velocity = vec4f(0.0);
    }
    
    return out;
}

fn hit_world(ray: Ray) -> HitRecord {
    let s1 = Sphere(vec3(0.0, 0.0, -5.0), 1.0, Material(vec3(1.0), vec3(0.0), 0.0, 0.9, -1.0));
    let s5 = Sphere(vec3(-5.0, 5.0, 0.0), 5.0, Material(vec3(1.0), vec3(0.9, 0.0, 0.9), 0.0, 0.0, -1.0));
    let s2 = Sphere(vec3(5.0, 3.0, -10.0), 4.0, Material(vec3(0.5,0.5,0.8), vec3(0.0), 0.1, 0.0, -1.0));
    let s3 = Sphere(vec3(0.0, -1001.0, 0.0), 1000.0, Material(vec3(0.2, 0.2, 0.2), vec3(0.0), 0.2, 0.0, -1.0));
    let s4 = Sphere(vec3(-5.0, 3.0, -20.0), 5.0, Material(vec3(0.2, 0.8, 0.6), vec3(0.9, 0.9, 0.9), 0.0, 0.0, -1.0));

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


fn calc_light(ray_in: Ray) -> PathTraceResult {
    var current_ray = ray_in;
    var radiance = vec3f(0.0);
    var throughput = vec3f(1.0);
    let MAX_BOUNCES = 6;

    var result: PathTraceResult;
    result.radiance = vec3f(0.0);
    result.first_normal = vec3f(0.0);
    result.first_depth = 10000.0;
    result.first_albedo = vec3f(1.0);
    result.first_roughness = 0.0;

    for (var bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        let rec = hit_world(current_ray); 

        if (rec.hit) {
            radiance += throughput * rec.mat.emission;

            var tex_color = vec3f(1.0);
            if (rec.mat.tex > -1.0) {
                tex_color = textureSampleLevel(tex, texture_sampler, rec.uv, i32(rec.mat.tex), 0.0).rgb;
            }
            let albedo = rec.mat.albedo * tex_color;
            
            if (bounce == 0) {
                result.first_normal = rec.normal;
                result.first_depth = rec.t;
                result.first_albedo = albedo;
                result.first_roughness = rec.mat.roughness;
            }
            
            if (rec.mat.ior > 0.01) {
                var outward_normal = rec.normal;
                var refraction_ratio = 1.0 / rec.mat.ior;

                if (dot(current_ray.direction, rec.normal) > 0.0) {
                    outward_normal = -rec.normal;
                    refraction_ratio = rec.mat.ior;
                }

                let refracted = refract(current_ray.direction, outward_normal, refraction_ratio);

                if (length(refracted) < 0.001) {
                    current_ray.direction = reflect(current_ray.direction, outward_normal);
                } else {
                    current_ray.direction = refracted;
                }
                
                throughput *= albedo; 
                
            } else {
                let diffuse_dir = normalize(rec.normal + random_unit_vector());
                let specular_dir = reflect(current_ray.direction, rec.normal);
                current_ray.direction = normalize(mix(specular_dir, diffuse_dir, rec.mat.roughness));
                throughput *= albedo;
            }

            current_ray.origin = rec.p + current_ray.direction * 0.001;
        } else {
            let sky_color = vec3f(0.1, 0.2, 0.3);
            radiance += throughput * sky_color;
            if (bounce == 0) {
                result.first_normal = -current_ray.direction;
                result.first_depth = 10000.0;
                result.first_albedo = vec3f(1.0); 
                result.first_roughness = 0.0;
            }
            break;
        }
    }
    result.radiance = radiance;
    return result;
}

@fragment
fn fs_blit(in : VertexOutput) -> @location(0) vec4f {
    let pos_i = vec2<i32>(floor(in.position.xy));
    var color = textureLoad(frame_tex, pos_i, 0).rgb;
    
    // 伽马校正
    color = pow(color, vec3f(1.0 / 2.2));
    
    return vec4f(color, 1.0); 
}