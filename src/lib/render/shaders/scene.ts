// -----------------------------------------------------------------------------
// WGSL shared by BOTH render paths (MDI vertex-fetch + vertex-pull). The
// two modules interpolate these so the clip/lighting/pick logic can never
// drift apart between the paths.
// -----------------------------------------------------------------------------

const RENDER_FRAME = /* wgsl */ `struct Frame {
  // CAMERA-RELATIVE: clip = view_proj * (world_abs - origin). Everything the
  // vertex stage interpolates (world, eye) is in that rebased space too —
  // f32 resolves ~1 mm at 10 km from the true origin, which speckles distant
  // geometry through both z-fighting and the derivative face normal.
  view_proj: mat4x4f,
  // xyz: the frame's rebase origin (the camera position, rounded); w unused
  origin: vec4f,
  // eye in REBASED space (= absolute eye - origin)
  eye: vec4f,
  // x: 1 = per-meshlet debug colors; y: suppress selection tint on overrides;
  // z: bit0 = blend transparency mode, bit1 = this is the blend pass;
  // w: frame counter (alpha-hash seed)
  flags: vec4u,
  // xyz: directional headlight (surface -> light), used when w == 1 (ortho).
  // Perspective (w == 0) lights from the eye point like the native headlight.
  light: vec4f,
  ambient: vec4f, // rgb = ambient color, a = intensity
  headlight: vec4f, // rgb = headlight color, a = intensity
  sel_color: vec4f, // selection highlight (rgb) + blend amount (a)
};`;

// item state + per-model uniform + shared bindings + the full clip system
const RENDER_COMMON = /* wgsl */ `struct ItemState {
  flags: u32, // bit 2 = selected, bit 4 = has color override
  color: u32, // packed RGBA8 override
  tidx: u32,  // committed transform slot; 0 = identity
};

@group(0) @binding(3) var<storage, read> item_states: array<ItemState>;
// optional authored normals: one u32 per GLOBAL vertex (2x snorm16 octahedral,
// see cook.ts); bound to a 1-word dummy when the model has none
// (model_uni.info.z = 0)
@group(0) @binding(7) var<storage, read> vertex_normals: array<u32>;

fn oct_decode(e: vec2f) -> vec3f {
  var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    let s = select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
    n = vec3f((vec2f(1.0) - abs(n.yx)) * s, n.z);
  }
  return normalize(n);
}
// per-model uniform: info.x = item_base (global id offset), info.y = live
// selection transform active; global = the live gizmo-drag group matrix,
// applied on top of committed transforms to SELECTED items only (native
// mesh.slang model_global — whole-selection drag with one UBO write).
struct ModelUni {
  info: vec4u,
  global: mat4x4f,
};
@group(0) @binding(4) var<uniform> model_uni: ModelUni;
// committed item transforms (renderer-global pool, slot 0 = identity)
@group(0) @binding(6) var<storage, read> transforms: array<mat4x4f>;

// stochastic transparency (native mesh.slang alpha_hash): different pixels
// discard each frame; TAA accumulates the result into smooth opacity
fn alpha_hash(pix: vec2u, frame: u32) -> f32 {
  var n = (pix.x * 1973u) + (pix.y * 9277u) + (frame * 26699u);
  n = (n << 13u) ^ n;
  n = n * (n * n * 15731u + 789221u) + 1376312589u;
  return f32(n & 0x7FFFFFFFu) / f32(0x7FFFFFFFu);
}

fn item_opacity(item: u32, base_a: f32) -> f32 {
  let st = item_states[item];
  if ((st.flags & 64u) != 0u) { // explicit opacity override wins
    return f32((st.flags >> 25u) & 127u) / 100.0;
  }
  if ((st.flags & 16u) != 0u) { // color override carries its own alpha
    return f32((st.color >> 24u) & 255u) / 255.0;
  }
  return base_a; // no override -> the baked material alpha (cg color .a)
}

fn apply_item_state(base: vec4f, item: u32) -> vec4f {
  let st = item_states[item];
  var c = base;
  let overridden = (st.flags & 16u) != 0u;
  if (overridden) { // color override
    c = vec4f(
      f32(st.color & 255u), f32((st.color >> 8u) & 255u), f32((st.color >> 16u) & 255u),
      255.0,
    ) / 255.0;
    c.a = base.a;
  }
  // selection highlight; frame.flags.y suppresses it on overridden items so
  // a just-applied color reads true — cleared again on the next selection
  if ((st.flags & 4u) != 0u && !(overridden && frame.flags.y == 1u)) {
    c = vec4f(mix(c.rgb, frame.sel_color.rgb, frame.sel_color.a), c.a);
  }
  return c;
}

// clip system (port of the native clip.slang model, phase A subset):
// 8 half-space planes + one axis-aligned box, evaluated per fragment
// One clip shape — the native GpuClipShape tagged union (clip.slang layout):
// inv_transform (world → shape-local, box kind only), params0 (box: local
// min.xyz | sphere: center.xyz + radius.w | cyl: base.xyz + radius.w), params1
// (box: local max.xyz | cyl: unit axis.xyz + height.w), kind_flags.x = kind
// (0 disabled, 1 box, 2 sphere, 3 cylinder), kind_flags.y = inverted (hole).
struct ClipShapeGpu {
  inv_transform: mat4x4f,
  params0: vec4f,
  params1: vec4f,
  kind_flags: vec4u,
};
struct ClipData {
  planes: array<vec4f, 8>, // xyz = unit normal, w = distance
  plane_mask: vec4u,       // x = enabled bitmask
  // slot 0 = the DEFAULT clip box (Clipping Box ribbon), slots 1..7 = the user
  // shapes — all evaluated together with the native union-of-keeps semantics
  shapes: array<ClipShapeGpu, 8>,
};

@group(0) @binding(5) var<uniform> clip: ClipData;

// True if p lies OUTSIDE the shape volume (native clip_shape_outside).
fn clip_shape_outside(s: ClipShapeGpu, p: vec3f) -> bool {
  switch (s.kind_flags.x) {
    case 1u: { // box: world → local, AABB test
      let local = (s.inv_transform * vec4f(p, 1.0)).xyz;
      return any(local < s.params0.xyz) || any(local > s.params1.xyz);
    }
    case 2u: { // sphere
      let d = p - s.params0.xyz;
      return dot(d, d) > s.params0.w * s.params0.w;
    }
    case 3u: { // cylinder: base + radius | axis + height
      let rel = p - s.params0.xyz;
      let t = dot(rel, s.params1.xyz);
      if (t < 0.0 || t > s.params1.w) { return true; }
      let radial = rel - t * s.params1.xyz;
      return dot(radial, radial) > s.params0.w * s.params0.w;
    }
    default: {
      return false; // disabled: never outside (no clipping)
    }
  }
}

fn clip_discard(p: vec3f) -> bool {
  let mask = clip.plane_mask.x;
  for (var i = 0u; i < 8u; i++) {
    if ((mask & (1u << i)) != 0u &&
        dot(clip.planes[i].xyz, p) + clip.planes[i].w < 0.0) {
      return true;
    }
  }
  // Shapes — native combine semantics (clip.slang): inverted shapes are holes
  // (each cuts what is inside it), normal shapes are keep-volumes (UNION — the
  // fragment survives if it is inside ANY of them).
  var any_keep = false;
  var inside_a_keep = false;
  for (var i = 0u; i < 8u; i++) {
    let sh = clip.shapes[i];
    if (sh.kind_flags.x == 0u) { continue; }
    let outside = clip_shape_outside(sh, p);
    if (sh.kind_flags.y != 0u) {
      if (!outside) { return true; } // hole: clip everything inside it
    } else {
      any_keep = true;
      if (!outside) { inside_a_keep = true; }
    }
  }
  if (any_keep && !inside_a_keep) { return true; } // outside every keep volume
  return false;
}

`;

// debug hash color + the VS→FS interface
const RENDER_MISC = /* wgsl */ `fn hash_color(i: u32) -> vec3f {
  var h = i * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  h = (h >> 22u) ^ h;
  return vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0;
}

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) id: u32,
  @location(3) @interpolate(flat) opacity: f32,
  // authored vertex normal (zero-length = flat-shade in the FS)
  @location(4) normal: vec3f,
};

`;

// fragment shaders: the lit main pass + the id-only pick pass
const RENDER_FS = /* wgsl */ `struct FsOut {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
  @location(2) id: vec4f, // item id packed into rgba8unorm (u32 -> 4x8 bit)
};

@fragment
fn fs(in: VsOut) -> FsOut {
  if (clip_discard(in.world + frame.origin.xyz)) { discard; }
  if ((frame.flags.z & 1u) == 0u && in.opacity < 1.0) {
    // alpha-hash mode: stochastic discard, converges under TAA
    if (alpha_hash(vec2u(in.clip.xy), frame.flags.w) > in.opacity) { discard; }
  }
  // authored normals when the model carries them (generic GLB import with
  // NORMAL data); zero-length = flat shading from screen-space derivatives.
  // dpdx/dpdy must run in uniform control flow, so the flat normal is always
  // computed and the authored one selected after.
  let flat_n = normalize(cross(dpdx(in.world), dpdy(in.world)));
  var n = flat_n;
  if (dot(in.normal, in.normal) > 0.01) {
    n = normalize(in.normal);
  }
  // headlight: point light at the eye (perspective) or view-axis directional
  // (ortho — a point headlight would shift with zoom, which reads wrong there)
  var l: vec3f;
  if (frame.light.w == 1.0) {
    l = frame.light.xyz;
  } else {
    l = normalize(frame.eye.xyz - in.world);
  }
  if (dot(n, l) < 0.0) { n = -n; } // two-sided: face the light/camera
  let t = dot(n, l);
  // native mesh.slang: half-Lambert + Blinn-Phong spec (headlight => half = l);
  // ambient + headlight color/intensity come from the lighting settings
  let diffuse = t * 0.5 + 0.5;
  let spec = pow(saturate(t), 16.0) * 0.3;
  let shade = frame.ambient.rgb * frame.ambient.a +
              frame.headlight.rgb * (frame.headlight.a * (diffuse + spec));
  let unlit_luma = dot(in.color.rgb, vec3f(0.299, 0.587, 0.114));
  var o: FsOut;
  // blend pass: alpha is the blend factor; otherwise it carries unlit luma
  let alpha = select(unlit_luma, in.opacity, (frame.flags.z & 2u) != 0u);
  o.color = vec4f(in.color.rgb * shade, alpha);
  // normal alpha = per-model edge tag for the post pass:
  //   0 = flat-shaded mesh, 0.5 = authored normals (own edge thresholds),
  //   1 = edge lines OFF (asset import option)
  var gtag = select(0.0, 0.5, model_uni.info.z == 1u);
  if (model_uni.info.w == 1u) { gtag = 1.0; }
  o.normal = vec4f(n * 0.5 + 0.5, gtag);
  o.id = vec4f(
    f32(in.id & 255u), f32((in.id >> 8u) & 255u),
    f32((in.id >> 16u) & 255u), f32((in.id >> 24u) & 255u),
  ) / 255.0;
  return o;
}

// Pick pass (native mesh_pick.frag.slang): ids only, with the opacity rule —
// plain: solid = opacity >= threshold; shift: solid = opacity < threshold ||
// opacity >= 0.999 (band invert). Non-solid fragments discard so the click
// falls through to whatever is behind. Threshold/shift ride in the pick frame
// slot's (otherwise unused) ambient.xy.
@fragment
fn fs_pick(in: VsOut) -> @location(0) vec4f {
  if (clip_discard(in.world + frame.origin.xyz)) { discard; }
  let thr = frame.ambient.x;
  var solid: bool;
  if (frame.ambient.y > 0.5) {
    solid = (in.opacity < thr) || (in.opacity >= 0.999);
  } else {
    solid = in.opacity >= thr;
  }
  if (!solid) { discard; }
  return vec4f(
    f32(in.id & 255u), f32((in.id >> 8u) & 255u),
    f32((in.id >> 16u) & 255u), f32((in.id >> 24u) & 255u),
  ) / 255.0;
}

// Outline mask pass (native hover_xray idea): depth-only render of ONLY the
// outlined subset — selected items (when frame.ambient.x, the include-selected
// flag, is set) and/or the hovered item (global id bitcast into ambient.y;
// 0 = none). Depth-tested against its own cleared target, NOT the scene, so
// the mask holds the subset's front surface even where other geometry
// occludes it — that is what makes the hidden-edge color possible.
@fragment
fn fs_outline(in: VsOut) {
  if (clip_discard(in.world + frame.origin.xyz)) { discard; }
  let sel = (item_states[in.id - model_uni.info.x].flags & 4u) != 0u;
  let hover_id = bitcast<u32>(frame.ambient.y);
  if (!((sel && frame.ambient.x > 0.5) || (hover_id != 0u && in.id == hover_id))) { discard; }
}
`;

// Flat shading only: face normal from screen-space derivatives of world position.
// Scene alpha carries the UNLIT base luminance (used by the edge pass for
// white-on-dark, like the native mesh.slang). Always writes the G-buffer:
// world normal (packed 0..1) and the item id packed into rgba8unorm — the
// packing lets the id target be multisampled (WebGPU forbids integer MSAA).
//
// quantized=true (MDI path): positions stay cooked u16 (uint16x4 attribute)
// and are dequantized here with the per-meshlet AABB from meshlet_info —
// same scheme as the native mesh shader. quantized=false (fallback path):
// pre-dequantized float32x3 positions and a slim meshlet_info.
export function renderWgsl(quantized: boolean): string {
  return /* wgsl */ `
${RENDER_FRAME}

${
  quantized
    ? `struct MeshletInfo {
  aabb_min: vec3f,
  cg: u32,   // color-group index (color lookup)
  aabb_scale: vec3f,
  item: u32, // globally unique draw-range item id (edge pass)
};`
    : `struct MeshletInfo {
  cg: u32,
  item: u32,
};`
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> cg_colors: array<vec4f>;
@group(0) @binding(2) var<storage, read> meshlet_info: array<MeshletInfo>;

// per-item state, native MeshItem bit layout (item_state.rs)
${RENDER_COMMON}${RENDER_MISC}@vertex
fn vs(
  @location(0) pos: ${quantized ? 'vec4u' : 'vec3f'},
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) inst: u32,
) -> VsOut {
  var o: VsOut;
  let info = meshlet_info[inst]; // inst = meshlet index (from the cull records)
  let opacity = item_opacity(info.item, cg_colors[info.cg].a);
  let blend_mode = (frame.flags.z & 1u) != 0u;
  let blend_pass = (frame.flags.z & 2u) != 0u;
  let transparent = opacity < 1.0;
  // hidden, or routed to the other pass in blend mode -> degenerate
  if ((item_states[info.item].flags & 1u) != 0u ||
      (blend_mode && transparent != blend_pass)) {
    o.clip = vec4f(0.0);
    o.world = vec3f(0.0);
    o.color = vec4f(0.0);
    o.id = 0u;
    o.opacity = 1.0;
    o.normal = vec3f(0.0);
    return o;
  }
  o.opacity = opacity;
  let tid = item_states[info.item].tidx;
  let live = model_uni.info.y == 1u && (item_states[info.item].flags & 4u) != 0u;
  // Rebase FIRST on the untransformed path: aabb_min - origin is an exact
  // f32 subtraction (both are nearby magnitudes), so the dequantized position
  // lands in small-number space and keeps micron precision however far the
  // model sits from the true origin. Transformed items must go through their
  // absolute-space matrix, so they rebase after (as precise as before).
${quantized ? '  var world = (info.aabb_min - frame.origin.xyz) + vec3f(pos.xyz) * info.aabb_scale;' : '  var world = pos - frame.origin.xyz;'}
  if (tid != 0u || live) {
${quantized ? '    var abs_world = info.aabb_min + vec3f(pos.xyz) * info.aabb_scale;' : '    var abs_world = pos;'}
    // committed item transform (native mesh.slang: pos = T * pos)
    if (tid != 0u) {
      abs_world = (transforms[tid] * vec4f(abs_world, 1.0)).xyz;
    }
    // live gizmo-drag preview on top, selected items only (native model_global)
    if (live) {
      abs_world = (model_uni.global * vec4f(abs_world, 1.0)).xyz;
    }
    world = abs_world - frame.origin.xyz;
  }
  // authored normal (generic GLB import); vid = index value + baseVertex =
  // the global vertex index the normal stream is laid out by
  o.normal = vec3f(0.0);
  if (model_uni.info.z == 1u) {
    var nrm = oct_decode(unpack2x16snorm(vertex_normals[vid]));
    if (tid != 0u) { nrm = (transforms[tid] * vec4f(nrm, 0.0)).xyz; }
    if (live) { nrm = (model_uni.global * vec4f(nrm, 0.0)).xyz; }
    o.normal = nrm; // renormalized in the FS after interpolation
  }
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.world = world;
  if (frame.flags.x == 1u) {
    o.color = vec4f(hash_color(inst), 1.0);
  } else {
    o.color = apply_item_state(cg_colors[info.cg], info.item);
  }
  o.id = info.item + model_uni.info.x; // globally unique for the id G-buffer
  return o;
}

${RENDER_FS}`;
}

// Vertex-pull render path (core WebGPU — no MDI needed): one non-indexed
// drawIndirect per model, instanceCount = visible meshlets from the cull.
// Each instance is one meshlet drawn as 372 vertices (124 tris max); vertex
// data is pulled from storage buffers, and padding vertices clamp to the
// meshlet's last index so excess triangles are zero-area (killed pre-raster).
export function renderVpWgsl(): string {
  return /* wgsl */ `
${RENDER_FRAME}

struct MeshletInfo {
  aabb_min: vec3f,
  cg: u32,
  aabb_scale: vec3f,
  item: u32,
};

// read-only mirror of the packed 36-byte cull records (cullWgsl layout); the
// draw only needs the three index/vertex words, decoded straight from the raw
// buffer (a struct binding would force a padded 48-byte stride)
struct MeshletDraw {
  index_count: u32,
  first_index: u32,
  base_vertex: u32,
};

fn load_geo(mi: u32) -> MeshletDraw {
  let o = mi * 9u;
  return MeshletDraw(geo[o + 5u], geo[o + 6u], geo[o + 8u]);
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> cg_colors: array<vec4f>;
@group(0) @binding(2) var<storage, read> meshlet_info: array<MeshletInfo>;

@group(1) @binding(0) var<storage, read> vis_list: array<u32>;
@group(1) @binding(1) var<storage, read> geo: array<u32>;
@group(1) @binding(2) var<storage, read> micro_indices: array<u32>; // u16 pairs
@group(1) @binding(3) var<storage, read> qverts: array<vec2u>; // u16x4 per vertex

// per-item state, native MeshItem bit layout (item_state.rs)
${RENDER_COMMON}${RENDER_MISC}@vertex
fn vs(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) inst: u32,
) -> VsOut {
  let mi = vis_list[inst];
  let m = load_geo(mi);
  // clamp padding vertices to the last real index -> zero-area triangles
  let li = min(vid, m.index_count - 1u);
  let gi = m.first_index + li;
  let word = micro_indices[gi >> 1u];
  let micro = select(word & 0xffffu, word >> 16u, (gi & 1u) == 1u);
  let v = qverts[m.base_vertex + micro];
  let q = vec3f(f32(v.x & 0xffffu), f32(v.x >> 16u), f32(v.y & 0xffffu));

  let info = meshlet_info[mi];
  var o: VsOut;
  let opacity = item_opacity(info.item, cg_colors[info.cg].a);
  let blend_mode = (frame.flags.z & 1u) != 0u;
  let blend_pass = (frame.flags.z & 2u) != 0u;
  let transparent = opacity < 1.0;
  // hidden, or routed to the other pass in blend mode -> degenerate
  if ((item_states[info.item].flags & 1u) != 0u ||
      (blend_mode && transparent != blend_pass)) {
    o.clip = vec4f(0.0);
    o.world = vec3f(0.0);
    o.color = vec4f(0.0);
    o.id = 0u;
    o.opacity = 1.0;
    o.normal = vec3f(0.0);
    return o;
  }
  o.opacity = opacity;
  // rebase before dequantizing — see the MDI path for why
  let tid = item_states[info.item].tidx;
  let live = model_uni.info.y == 1u && (item_states[info.item].flags & 4u) != 0u;
  var world = (info.aabb_min - frame.origin.xyz) + q * info.aabb_scale;
  if (tid != 0u || live) {
    var abs_world = info.aabb_min + q * info.aabb_scale;
    // committed item transform (native mesh.slang: pos = T * pos)
    if (tid != 0u) {
      abs_world = (transforms[tid] * vec4f(abs_world, 1.0)).xyz;
    }
    // live gizmo-drag preview on top, selected items only (native model_global)
    if (live) {
      abs_world = (model_uni.global * vec4f(abs_world, 1.0)).xyz;
    }
    world = abs_world - frame.origin.xyz;
  }
  // authored normal (generic GLB import): same global vertex index as qverts
  o.normal = vec3f(0.0);
  if (model_uni.info.z == 1u) {
    var nrm = oct_decode(unpack2x16snorm(vertex_normals[m.base_vertex + micro]));
    if (tid != 0u) { nrm = (transforms[tid] * vec4f(nrm, 0.0)).xyz; }
    if (live) { nrm = (model_uni.global * vec4f(nrm, 0.0)).xyz; }
    o.normal = nrm; // renormalized in the FS after interpolation
  }
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.world = world;
  if (frame.flags.x == 1u) {
    o.color = vec4f(hash_color(mi), 1.0);
  } else {
    o.color = apply_item_state(cg_colors[info.cg], info.item);
  }
  o.id = info.item + model_uni.info.x;
  return o;
}

${RENDER_FS}`;
}

// Clip helper lines (plane rectangles, box edges): world-space line list,
// color packed in the w component (RGBA8 bitcast). Drawn after the scene
// with depth testing but no depth writes.
export function lineWgsl(): string {
  return /* wgsl */ `
struct Frame {
  // first two members of the shared Frame (camera-relative rendering): the
  // line vertices below are ABSOLUTE world, so they rebase here too
  view_proj: mat4x4f,
  origin: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs(@location(0) a: vec4f) -> VsOut {
  var o: VsOut;
  o.clip = frame.view_proj * vec4f(a.xyz - frame.origin.xyz, 1.0);
  let c = bitcast<u32>(a.w);
  o.color = vec4f(
    f32(c & 255u), f32((c >> 8u) & 255u), f32((c >> 16u) & 255u), f32((c >> 24u) & 255u),
  ) / 255.0;
  return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return vec4f(in.color.rgb, 1.0);
}
`;
}
