// Measurement snap compute — port of the native measure_snap.slang.
//
// Casts the cursor ray against a model's triangles (Möller–Trumbore) and returns
// the CLOSEST hit's triangle + barycentrics. The CPU classifies corner / edge /
// face from the barycentrics and screen-space pixel distances, exactly like the
// native compute_measure_probe. Geometry is the meshlet-packed layout the render
// shaders consume: quantized u16 positions dequantized with the per-meshlet AABB,
// u16 meshlet-local indices offset by base_vertex.
//
// Two-pass arg-min over u32 atomics (t > 0, so IEEE bit order == float order):
//   pass 1 (snapMin):   atomicMin the closest hit distance into result[0].
//   pass 2 (snapWrite): triangles whose distance equals that minimum write their
//                       three world vertices + barycentrics + valid.
// WebGPU inserts implicit barriers between dispatches, so both passes can share
// one compute pass. Hidden items are skipped; committed item transforms apply.
//
// Result words: [0]=t bits · [1]=valid · [2]=u · [3]=v · [4..6]=A · [7..9]=B ·
export function measureSnapWgsl(): string {
  return /* wgsl */ `
// logical view of one packed 36-byte cull record (cullWgsl layout, raw words)
struct MeshletGeo {
  center: vec3f,
  radius: f32,
  index_count: u32,
  first_index: u32,
  base_vertex: u32,
};
const SNAP_MESHLET_WORDS = 9u;
struct MeshletInfo {
  aabb_min: vec3f,
  cg: u32,
  aabb_scale: vec3f,
  item: u32,
};
struct ItemState {
  flags: u32,
  color: u32,
  tidx: u32,
};
struct SnapParams {
  ray_origin: vec4f, // xyz = origin (near-plane point under the cursor)
  ray_dir: vec4f,    // xyz = normalized direction
};

@group(0) @binding(0) var<storage, read_write> result: array<atomic<u32>, 16>;
@group(0) @binding(1) var<storage, read> geo: array<u32>;

fn load_geo(mi: u32) -> MeshletGeo {
  let o = mi * SNAP_MESHLET_WORDS;
  var m: MeshletGeo;
  m.center = vec3f(bitcast<f32>(geo[o]), bitcast<f32>(geo[o + 1u]), bitcast<f32>(geo[o + 2u]));
  m.radius = bitcast<f32>(geo[o + 3u]);
  m.index_count = geo[o + 5u];
  m.first_index = geo[o + 6u];
  m.base_vertex = geo[o + 8u];
  return m;
}
@group(0) @binding(2) var<storage, read> minfo: array<MeshletInfo>;
@group(0) @binding(3) var<storage, read> micro_indices: array<u32>; // u16 pairs
@group(0) @binding(4) var<storage, read> qverts: array<vec2u>;      // u16x4 per vertex
@group(0) @binding(5) var<storage, read> item_states: array<ItemState>;
@group(0) @binding(6) var<storage, read> transforms: array<mat4x4f>;
@group(0) @binding(7) var<uniform> sp: SnapParams;

// Möller–Trumbore. Returns vec4f(t, u, v, hit): hit > 0 when the ray o + t·d
// (t > 0) pierces [A,B,C]; hit point = (1−u−v)A + uB + vC.
fn ray_tri(o: vec3f, d: vec3f, A: vec3f, B: vec3f, C: vec3f) -> vec4f {
  let e1 = B - A;
  let e2 = C - A;
  let p = cross(d, e2);
  let det = dot(e1, p);
  if (abs(det) < 1e-9) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let inv = 1.0 / det;
  let tv = o - A;
  let u = dot(tv, p) * inv;
  if (u < 0.0 || u > 1.0) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let q = cross(tv, e1);
  let v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let t = dot(e2, q) * inv;
  if (t <= 0.0) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  return vec4f(t, u, v, 1.0);
}

// One meshlet-local vertex → world space (dequant + committed item transform).
fn vert_world(m: MeshletGeo, info: MeshletInfo, local: u32, tid: u32) -> vec3f {
  let v = qverts[m.base_vertex + local];
  let q = vec3f(f32(v.x & 0xffffu), f32(v.x >> 16u), f32(v.y & 0xffffu));
  var world = info.aabb_min + q * info.aabb_scale;
  if (tid != 0u) {
    world = (transforms[tid] * vec4f(world, 1.0)).xyz;
  }
  return world;
}

fn local_index(m: MeshletGeo, tri: u32, corner: u32) -> u32 {
  let gi = m.first_index + tri * 3u + corner;
  let word = micro_indices[gi >> 1u];
  return select(word & 0xffffu, word >> 16u, (gi & 1u) == 1u);
}

// Cheap ray↔bounding-sphere reject (center moved by the item transform, like
// the cull shader). Purely an early-out — misses nothing the loop would hit.
fn sphere_miss(m: MeshletGeo, tid: u32) -> bool {
  var c = m.center;
  if (tid != 0u) {
    c = (transforms[tid] * vec4f(c, 1.0)).xyz;
  }
  let oc = c - sp.ray_origin.xyz;
  let along = dot(oc, sp.ray_dir.xyz);
  let d2 = dot(oc, oc) - along * along;
  // radius unscaled by the transform — pad generously (2×) to stay conservative
  let r = m.radius * 2.0;
  return along < -r || d2 > r * r;
}

@compute @workgroup_size(64)
fn snapMin(@builtin(global_invocation_id) gid: vec3u) {
  let mi = gid.x;
  if (mi >= arrayLength(&geo) / SNAP_MESHLET_WORDS) { return; }
  let m = load_geo(mi);
  let info = minfo[mi];
  let st = item_states[info.item];
  if ((st.flags & 1u) != 0u) { return; } // hidden item
  if (sphere_miss(m, st.tidx)) { return; }
  let o = sp.ray_origin.xyz;
  let d = sp.ray_dir.xyz;
  let tris = m.index_count / 3u;
  for (var tri = 0u; tri < tris; tri++) {
    let A = vert_world(m, info, local_index(m, tri, 0u), st.tidx);
    let B = vert_world(m, info, local_index(m, tri, 1u), st.tidx);
    let C = vert_world(m, info, local_index(m, tri, 2u), st.tidx);
    let h = ray_tri(o, d, A, B, C);
    if (h.w > 0.0) {
      atomicMin(&result[0], bitcast<u32>(h.x));
    }
  }
}

@compute @workgroup_size(64)
fn snapWrite(@builtin(global_invocation_id) gid: vec3u) {
  let mi = gid.x;
  if (mi >= arrayLength(&geo) / SNAP_MESHLET_WORDS) { return; }
  let m = load_geo(mi);
  let info = minfo[mi];
  let st = item_states[info.item];
  if ((st.flags & 1u) != 0u) { return; }
  if (sphere_miss(m, st.tidx)) { return; }
  let best_t = bitcast<f32>(atomicLoad(&result[0]));
  let o = sp.ray_origin.xyz;
  let d = sp.ray_dir.xyz;
  let tris = m.index_count / 3u;
  for (var tri = 0u; tri < tris; tri++) {
    let A = vert_world(m, info, local_index(m, tri, 0u), st.tidx);
    let B = vert_world(m, info, local_index(m, tri, 1u), st.tidx);
    let C = vert_world(m, info, local_index(m, tri, 2u), st.tidx);
    let h = ray_tri(o, d, A, B, C);
    // tolerance absorbs fp reassociation between the two passes
    if (h.w > 0.0 && h.x <= best_t * 1.0001) {
      atomicStore(&result[1], 1u);
      atomicStore(&result[2], bitcast<u32>(h.y));
      atomicStore(&result[3], bitcast<u32>(h.z));
      atomicStore(&result[4], bitcast<u32>(A.x));
      atomicStore(&result[5], bitcast<u32>(A.y));
      atomicStore(&result[6], bitcast<u32>(A.z));
      atomicStore(&result[7], bitcast<u32>(B.x));
      atomicStore(&result[8], bitcast<u32>(B.y));
      atomicStore(&result[9], bitcast<u32>(B.z));
      atomicStore(&result[10], bitcast<u32>(C.x));
      atomicStore(&result[11], bitcast<u32>(C.y));
      atomicStore(&result[12], bitcast<u32>(C.z));
    }
  }
}
`;
}
