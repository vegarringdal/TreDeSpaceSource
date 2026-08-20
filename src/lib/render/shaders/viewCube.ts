/** Composite the view cube's resolved MSAA offscreen onto the swapchain.
 *  The offscreen is cleared transparent and resolved, so its colour is
 *  premultiplied by coverage — the pipeline blends one / one-minus-src-alpha. */
export function cubeBlitWgsl(): string {
  return /* wgsl */ `
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var o: VsOut;
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(img, samp, in.uv);
}
`;
}

/** Canvas-drawn view cube (see src/lib/viewCubeGpu.ts for the geometry).
 *  Vertex = pos.xyz | zoneId | uv | faceSlot | isBevel; the uniform carries the
 *  authored→NDC matrix (camera rotation + mini-viewport ortho) and the hovered
 *  zone. Faces sample the 6-tile label atlas; bevels/corners are solid. */
export function viewCubeWgsl(): string {
  return /* wgsl */ `
struct CubeFrame {
  mvp: mat4x4f,
  // x = hovered zone id (-1 none), y = opacity
  params: vec4f,
  // world-space toward-viewer direction — plates facing away are discarded
  // (facing by normal, not winding: no cull mode to get wrong)
  viewer: vec4f,
  // settings-driven palette (sketch mode swaps in its own set)
  face_col: vec4f,   // face plates
  bevel_col: vec4f,  // edge/corner plates (face colour, slightly lifted)
  line_col: vec4f,   // inset border
  hover_col: vec4f,  // hovered zone highlight
};

@group(0) @binding(0) var<uniform> frame: CubeFrame;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) zone: f32,
  @location(2) @interpolate(flat) face_slot: f32,
  @location(3) @interpolate(flat) is_bevel: f32,
  @location(4) @interpolate(flat) facing: f32,
};

@vertex
fn vs(
  @location(0) pos_zone: vec4f,
  @location(1) uv_flags: vec4f,
  @location(2) normal: vec3f,
) -> VsOut {
  var o: VsOut;
  o.clip = frame.mvp * vec4f(pos_zone.xyz, 1.0);
  o.zone = pos_zone.w;
  o.uv = uv_flags.xy;
  o.face_slot = uv_flags.z;
  o.is_bevel = uv_flags.w;
  o.facing = dot(normal, frame.viewer.xyz);
  return o;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  if (in.facing <= 0.0) { discard; } // away-facing plate
  var col = select(frame.face_col.rgb, frame.bevel_col.rgb, in.is_bevel > 0.5);
  if (in.zone == frame.params.x) { col = frame.hover_col.rgb; }
  // inset border like the DOM plates (skip on the corner triangles — their
  // uv space is the clip-path square, not the triangle). Analytic AA: the
  // border is fragment-computed, so MSAA can't smooth it — fwidth can.
  // The derivative is taken OUTSIDE the branch: uniformity analysis rejects
  // fwidth under a condition that varies per fragment.
  let e = min(min(in.uv.x, 1.0 - in.uv.x), min(in.uv.y, 1.0 - in.uv.y));
  let w = max(fwidth(e), 1e-4);
  if (in.face_slot >= 0.0 || in.is_bevel < 1.5) {
    col = mix(col, frame.line_col.rgb, 1.0 - smoothstep(0.035 - w, 0.035 + w, e));
  }
  // sample unconditionally (textureSample needs uniform control flow), then
  // mask the label onto faces only
  let tile = vec2f((in.uv.x + max(in.face_slot, 0.0)) / 6.0, in.uv.y);
  let label = textureSample(atlas, samp, tile);
  let is_face = select(0.0, 1.0, in.face_slot >= 0.0);
  col = mix(col, label.rgb, label.a * is_face);
  return vec4f(col, frame.params.y);
}
`;
}
