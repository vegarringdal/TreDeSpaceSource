// Two-pass GPU occlusion culling (same scheme as the native renderer):
//   pass 1: draw meshlets that were visible last frame (frustum+cone tested)
//   HZB:    build a min-reduction depth pyramid from the pass-1 depth
//   pass 2: test ALL meshlets against frustum+cone+HZB; draw the ones that
//           just became visible; persist visibility for next frame's pass 1.
// Sphere -> screen-rect projection ported from niagara (zeux), reversed-Z.

const CULL_COMMON = /* wgsl */ `
// Logical view of one packed 36-byte cull record (see load_meshlet): a WGSL
// struct binding would pad vec3f fields to a 48-byte stride, so the buffer is
// bound as raw words and decoded per meshlet.
struct MeshletCull {
  center: vec3f,
  radius: f32,
  axis: vec3f,   // s8 snorm in the record — NOT renormalized (meshopt s8 test)
  cutoff: f32,   // >= 1 means degenerate (skip cone test)
  index_count: u32,
  first_index: u32,
  cg: u32,
  base_vertex: u32, // global first vertex of the meshlet (u16 local indices)
};
const MESHLET_WORDS = 9u;

struct CullParams {
  planes: array<vec4f, 6>,
  view: mat4x4f,
  eye: vec4f,
  p00: f32,
  p11: f32,
  znear: f32,
  mip_count: f32,
  pyramid_size: vec2f,
  px_cut: f32,       // cull meshlets whose projected radius < this (0 = off)
  protect_dist: f32, // never px-cut meshlets closer than this
  viewport_h: f32,
  is_ortho: u32,     // 1 = orthographic (p00/p11 are 1/half_w, 1/half_h)
  ortho_near: f32,   // ortho view-depth slab for HZB depth reconstruction
  ortho_far: f32,
};

@group(0) @binding(0) var<storage, read> meshlets: array<u32>;

fn load_meshlet(i: u32) -> MeshletCull {
  let o = i * MESHLET_WORDS;
  var m: MeshletCull;
  m.center = vec3f(bitcast<f32>(meshlets[o]), bitcast<f32>(meshlets[o + 1u]), bitcast<f32>(meshlets[o + 2u]));
  m.radius = bitcast<f32>(meshlets[o + 3u]);
  let cone = unpack4x8snorm(meshlets[o + 4u]); // [axis.xyz, cutoff]
  m.axis = cone.xyz;
  m.cutoff = cone.w;
  m.index_count = meshlets[o + 5u];
  m.first_index = meshlets[o + 6u];
  m.cg = meshlets[o + 7u];
  m.base_vertex = meshlets[o + 8u];
  return m;
}
@group(0) @binding(3) var<storage, read_write> vis: array<u32>;
// meshlet_info words (item id at word 7) + per-item [flags, color, tidx]:
// hidden items are culled here so they cost nothing downstream.
// IMPORTANT: both cull passes evaluate this identically (two-pass rule).
@group(0) @binding(4) var<storage, read> info_words: array<u32>;
struct ItemStateCull {
  flags: u32,
  color: u32,
  tidx: u32, // 0 = identity, else index into transforms_cull
};
@group(0) @binding(5) var<storage, read> item_states_cull: array<ItemStateCull>;
@group(0) @binding(6) var<storage, read> transforms_cull: array<mat4x4f>;
// same per-model uniform the render shaders bind: live gizmo-drag matrix
// applied to SELECTED items (info.y = active) — mirrors the mesh shader
struct ModelUniCull {
  info: vec4u,
  global: mat4x4f,
};
@group(0) @binding(7) var<uniform> model_uni_cull: ModelUniCull;
@group(1) @binding(0) var<uniform> params: CullParams;

fn item_hidden(i: u32) -> bool {
  let item = info_words[i * 8u + 7u];
  return (item_states_cull[item].flags & 1u) != 0u;
}

fn item_transform(i: u32) -> u32 {
  return item_states_cull[info_words[i * 8u + 7u]].tidx;
}

fn item_live(i: u32) -> bool {
  return model_uni_cull.info.y == 1u &&
    (item_states_cull[info_words[i * 8u + 7u]].flags & 4u) != 0u;
}

// mirror of the fragment clip (native cull.slang does the same): meshlets
// whose bounding sphere is entirely on the cut side never rasterize
struct ClipShapeCull {
  inv_transform: mat4x4f,
  params0: vec4f,
  params1: vec4f,
  kind_flags: vec4u,
};
struct ClipDataCull {
  planes: array<vec4f, 8>,
  plane_mask: vec4u,
  shapes: array<ClipShapeCull, 8>, // slot 0 = default box, 1..7 = user shapes
};
@group(1) @binding(3) var<uniform> cclip: ClipDataCull;

fn clip_culled(center: vec3f, radius: f32) -> bool {
  let mask = cclip.plane_mask.x;
  for (var i = 0u; i < 8u; i++) {
    if ((mask & (1u << i)) != 0u &&
        dot(cclip.planes[i].xyz, center) + cclip.planes[i].w < -radius) {
      return true; // sphere fully behind an enabled plane
    }
  }
  // Shapes (slot 0 = the default box) — must match the fragment semantics
  // (native cull.slang), evaluated conservatively on the bounding sphere:
  //   holes: a sphere entirely INSIDE an inverted shape is fully discarded
  //   keeps: cull only when entirely outside EVERY keep volume (union-of-keeps)
  // The box inv_transform is rotation+translation only (clipPack.ts), so the
  // world-space radius is valid in box-local units.
  var any_keep = false;
  var maybe_inside = false;
  for (var si = 0u; si < 8u; si++) {
    let cs = cclip.shapes[si];
    if (cs.kind_flags.x == 0u) { continue; }
    if (cs.kind_flags.y != 0u) { // hole: cull when the sphere is fully inside
      var entirely_inside = false;
      if (cs.kind_flags.x == 1u) { // box: shrunk-AABB test in box-local space
        let local = (cs.inv_transform * vec4f(center, 1.0)).xyz;
        entirely_inside = all(local >= cs.params0.xyz + vec3f(radius)) &&
                          all(local <= cs.params1.xyz - vec3f(radius));
      } else if (cs.kind_flags.x == 2u) { // sphere-in-sphere
        let d = center - cs.params0.xyz;
        let rr = cs.params0.w - radius;
        entirely_inside = rr > 0.0 && dot(d, d) < rr * rr;
      } else { // cylinder: axial slab + shrunk radial distance
        let rel = center - cs.params0.xyz;
        let t = dot(rel, cs.params1.xyz);
        let radial = rel - t * cs.params1.xyz;
        let rr = cs.params0.w - radius;
        entirely_inside = rr > 0.0 && t >= radius && t <= cs.params1.w - radius &&
                          dot(radial, radial) < rr * rr;
      }
      if (entirely_inside) { return true; } // fully carved away by the hole
      continue;
    }
    any_keep = true;
    var entirely_outside = false;
    if (cs.kind_flags.x == 1u) { // box: expanded-AABB test in box-local space
      let local = (cs.inv_transform * vec4f(center, 1.0)).xyz;
      entirely_outside = any(local < cs.params0.xyz - vec3f(radius)) ||
                         any(local > cs.params1.xyz + vec3f(radius));
    } else if (cs.kind_flags.x == 2u) { // sphere-sphere
      let d = center - cs.params0.xyz;
      let rr = cs.params0.w + radius;
      entirely_outside = dot(d, d) > rr * rr;
    } else { // cylinder: each condition alone proves the sphere fully outside
      let rel = center - cs.params0.xyz;
      let t = dot(rel, cs.params1.xyz);
      let radial = rel - t * cs.params1.xyz;
      let rr = cs.params0.w + radius;
      entirely_outside = t < -radius || t > cs.params1.w + radius ||
                         dot(radial, radial) > rr * rr;
    }
    if (!entirely_outside) { maybe_inside = true; }
  }
  if (any_keep && !maybe_inside) { return true; } // outside every keep volume
  return false;
}

// skip_cone: transformed meshlets skip the cone test — the cone is in the
// untransformed frame (same rule as native cull.slang).
fn frustum_cone_visible(m: MeshletCull, skip_cone: bool) -> bool {
  for (var p = 0u; p < 6u; p++) {
    if (dot(params.planes[p].xyz, m.center) + params.planes[p].w < -m.radius) {
      return false;
    }
  }
  if (m.cutoff < 1.0 && !skip_cone) {
    // meshopt cone test, apex-free conservative form (niagara): the cluster
    // faces entirely away when the view ray to its bounding sphere lies
    // inside the normal cone — the +radius term absorbs the dropped apex
    let to_c = m.center - params.eye.xyz;
    if (dot(to_c, m.axis) >= m.cutoff * length(to_c) + m.radius) {
      return false;
    }
  }
  if (params.px_cut > 0.0) {
    let dist = distance(m.center, params.eye.xyz);
    if (dist - m.radius > params.protect_dist) {
      // ortho: projected size is distance-independent (p11 = 1/half_h)
      var rpx: f32;
      if (params.is_ortho == 1u) {
        rpx = m.radius * params.p11 * params.viewport_h * 0.5;
      } else {
        rpx = m.radius * params.p11 / max(dist, 1e-6) * params.viewport_h * 0.5;
      }
      if (rpx < params.px_cut) { return false; }
    }
  }
  return true;
}

`;

// MDI mode: append a full drawIndexedIndirect record, count in a plain atomic.
// VP (vertex-pull) mode: append just the meshlet index to a visible list; the
// counter doubles as instanceCount inside a drawIndirect args block
// [vertexCount, instanceCount, firstVertex, firstInstance] (372 = 124 tris x 3,
// stamped by thread 0 each dispatch — the block is cleared every frame).
const CULL_EMIT_MDI = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> records: array<u32>;
@group(0) @binding(2) var<storage, read_write> draw_count: atomic<u32>;

fn emit(m: MeshletCull, i: u32) {
  let slot = atomicAdd(&draw_count, 1u) * 5u;
  records[slot + 0u] = m.index_count;
  records[slot + 1u] = 1u;
  records[slot + 2u] = m.first_index;
  records[slot + 3u] = m.base_vertex;
  // firstInstance = meshlet index; the render shader looks up color-group
  // and item id in meshlet_info
  records[slot + 4u] = i;
}
`;

const CULL_EMIT_VP = /* wgsl */ `
struct DrawArgs {
  vertex_count: u32,
  instance_count: atomic<u32>,
  first_vertex: u32,
  first_instance: u32,
};
@group(0) @binding(1) var<storage, read_write> vis_list: array<u32>;
@group(0) @binding(2) var<storage, read_write> args: DrawArgs;

fn emit(m: MeshletCull, i: u32) {
  vis_list[atomicAdd(&args.instance_count, 1u)] = i;
}

fn stamp_args(gid: vec3u) {
  if (gid.x == 0u) { args.vertex_count = 372u; }
}
`;

const CULL1_MAIN = /* wgsl */ `
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  STAMP
  let i = gid.x;
  if (i >= arrayLength(&meshlets) / MESHLET_WORDS) { return; }
  if (vis[i] == 0u) { return; }
  if (item_hidden(i)) { return; }
  var m = load_meshlet(i);
  // committed item transform: move the bounding sphere to the transformed
  // position so frustum/clip tests use the right location (native cull.slang)
  let tid = item_transform(i);
  if (tid != 0u) {
    m.center = (transforms_cull[tid] * vec4f(m.center, 1.0)).xyz;
  }
  // live gizmo-drag preview on top (selected items only, like the VS)
  let live = item_live(i);
  if (live) {
    m.center = (model_uni_cull.global * vec4f(m.center, 1.0)).xyz;
  }
  if (clip_culled(m.center, m.radius)) { return; }
  if (frustum_cone_visible(m, tid != 0u || live)) { emit(m, i); }
}
`;

const CULL2_BODY = /* wgsl */ `
@group(1) @binding(1) var hzb: texture_2d<f32>;

// Conservative screen-space AABB of a view-space sphere (niagara's
// projectSphere). c.z is positive distance in front of the camera.
// Returns false when the sphere clips the near region (treat as visible).
fn project_sphere(c: vec3f, r: f32, aabb: ptr<function, vec4f>) -> bool {
  if (c.z < r + params.znear) { return false; }
  let cx = -vec2f(c.x, c.z);
  let vx = vec2f(sqrt(dot(cx, cx) - r * r), r);
  let minx = mat2x2f(vx.x, vx.y, -vx.y, vx.x) * cx;
  let maxx = mat2x2f(vx.x, -vx.y, vx.y, vx.x) * cx;
  let cy = -vec2f(c.y, c.z);
  let vy = vec2f(sqrt(dot(cy, cy) - r * r), r);
  let miny = mat2x2f(vy.x, vy.y, -vy.y, vy.x) * cy;
  let maxy = mat2x2f(vy.x, -vy.y, vy.y, vy.x) * cy;
  var box = vec4f(
    minx.x / minx.y * params.p00, miny.x / miny.y * params.p11,
    maxx.x / maxx.y * params.p00, maxy.x / maxy.y * params.p11,
  );
  box = box.xwzy * vec4f(0.5, -0.5, 0.5, -0.5) + vec4f(0.5); // clip -> uv
  *aabb = box;
  return true;
}

fn occlusion_visible(m: MeshletCull) -> bool {
  let cv = (params.view * vec4f(m.center, 1.0)).xyz;
  let c = vec3f(cv.x, cv.y, -cv.z); // view looks down -Z; flip to +Z forward
  var aabb = vec4f(0.0);
  var sphere_depth_ortho = 0.0;
  if (params.is_ortho == 1u) {
    // ortho projection of a sphere is exact: constant scale, linear depth
    let uv = vec2f(c.x * params.p00, c.y * params.p11) * vec2f(0.5, -0.5) + vec2f(0.5);
    let ext = vec2f(m.radius * params.p00, m.radius * params.p11) * 0.5;
    aabb = vec4f(uv - ext, uv + ext);
    sphere_depth_ortho =
      (params.ortho_far - (c.z - m.radius)) / max(params.ortho_far - params.ortho_near, 1e-4);
  } else if (!project_sphere(c, m.radius, &aabb)) {
    return true;
  }

  let w = (aabb.z - aabb.x) * params.pyramid_size.x;
  let h = (aabb.w - aabb.y) * params.pyramid_size.y;
  let level = u32(clamp(floor(log2(max(max(w, h), 1.0))), 0.0, params.mip_count - 1.0));
  let dims = textureDimensions(hzb, level);
  let maxc = dims - 1u;
  let fdims = vec2f(dims);
  let a = min(vec2u(clamp(aabb.xy, vec2f(0.0), vec2f(1.0)) * fdims), maxc);
  let b = min(vec2u(clamp(aabb.zw, vec2f(0.0), vec2f(1.0)) * fdims), maxc);
  // min over the 4 corner texels = farthest occluder depth (reversed-Z)
  let d = min(
    min(textureLoad(hzb, a, level).x, textureLoad(hzb, vec2u(b.x, a.y), level).x),
    min(textureLoad(hzb, vec2u(a.x, b.y), level).x, textureLoad(hzb, b, level).x),
  );
  var sphere_depth: f32;
  if (params.is_ortho == 1u) {
    sphere_depth = sphere_depth_ortho;
  } else {
    sphere_depth = params.znear / (c.z - m.radius); // nearest point of sphere
  }
  return sphere_depth >= d;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  STAMP
  let i = gid.x;
  if (i >= arrayLength(&meshlets) / MESHLET_WORDS) { return; }
  if (item_hidden(i)) {
    vis[i] = 0u;
    return;
  }
  var m = load_meshlet(i);
  let tid = item_transform(i);
  if (tid != 0u) {
    m.center = (transforms_cull[tid] * vec4f(m.center, 1.0)).xyz;
  }
  let live = item_live(i);
  if (live) {
    m.center = (model_uni_cull.global * vec4f(m.center, 1.0)).xyz;
  }
  if (clip_culled(m.center, m.radius)) {
    vis[i] = 0u;
    return;
  }
  // transformed meshlets skip the HZB test: the pyramid holds last frame's
  // depths at the OLD position — testing the moved center against it would
  // wrongly occlude (same rule as native cull.slang)
  let moved = tid != 0u || live;
  let visible = frustum_cone_visible(m, moved) && (moved || occlusion_visible(m));
  if (visible && vis[i] == 0u) { emit(m, i); } // not drawn in pass 1
  vis[i] = select(0u, 1u, visible);
}
`;

/** Cull shader for (pass, emit-mode). vp=true emits a visible-meshlet list +
 * drawIndirect args (core WebGPU, no MDI); vp=false emits MDI draw records. */
export function cullWgsl(pass2: boolean, vp: boolean): string {
  const emit = vp ? CULL_EMIT_VP : CULL_EMIT_MDI;
  const body = pass2 ? CULL2_BODY : CULL1_MAIN;
  return (CULL_COMMON + emit + body).replaceAll('STAMP', vp ? 'stamp_args(gid);' : '');
}

// Min-reduction depth downsample. Source is the depth buffer for mip 0
// (multisampled variant reduces over all samples), the previous pyramid mip
// otherwise. Odd source sizes fold the extra row/column into the last texel
// so the reduction stays conservative.
export function hzbWgsl(msaa: boolean): string {
  return /* wgsl */ `
@group(0) @binding(0) var src: ${msaa ? 'texture_multisampled_2d<f32>' : 'texture_2d<f32>'};
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;

fn src_min(c: vec2u) -> f32 {
${
  msaa
    ? `  var d = 1.0;
  for (var s = 0u; s < textureNumSamples(src); s++) {
    d = min(d, textureLoad(src, c, i32(s)).x);
  }
  return d;`
    : `  return textureLoad(src, c, 0).x;`
}
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dsize = textureDimensions(dst);
  if (gid.x >= dsize.x || gid.y >= dsize.y) { return; }
  let ssize = textureDimensions(src);
  let base = gid.xy * 2u;
  let nx = select(2u, 3u, (ssize.x & 1u) == 1u);
  let ny = select(2u, 3u, (ssize.y & 1u) == 1u);
  var d = 1.0;
  for (var y = 0u; y < ny; y++) {
    for (var x = 0u; x < nx; x++) {
      d = min(d, src_min(min(base + vec2u(x, y), ssize - 1u)));
    }
  }
  textureStore(dst, gid.xy, vec4f(d, 0.0, 0.0, 0.0));
}
`;
}
