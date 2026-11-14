// Laser-scan points (.tdpp): one screen-aligned square per point, expanded
// from a per-node storage buffer (instance = point, 6 vertices = 2 triangles).
// Drawn opaque in the last scene pass before the helper overlays, depth
// written and tested like the model (reversed-Z), honouring the clip system.
// The colour is the scan's own (photographic, so unlit); the G-buffer gets a
// camera-facing normal and the tag bits "edges off" (a cloud would otherwise
// light up with depth edges between neighbouring points), "carries colour"
// and the helper bit (sketch mode keeps the points' colour on the paper).
import { clipWgsl, HELPER_TAG_BIT } from './scene';

/** Node buffer layout (pointsLayer.ts): word 0..3 = header (x: effective
 *  spacing f32 bits), then 4 words per point: x, y, z f32 bits (relative to
 *  the cloud origin) and r | g << 8 | b << 16 | intensity8 << 24. */
export const POINT_WORDS = 4;
export const POINT_HEADER_WORDS = 4;

/** G-buffer tag of a point sample: edges off (2) | carries colour (16) | helper (128). */
const POINT_TAG = 2 | 16 | HELPER_TAG_BIT;

export function pointsWgsl(): string {
  return /* wgsl */ `
struct Frame {
  // the shared Frame's leading members (camera-relative rendering)
  view_proj: mat4x4f,
  origin: vec4f,
  eye: vec4f,
  flags: vec4u,
  light: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;

${clipWgsl(1)}

struct Cloud {
  // xyz: cloud origin - frame origin (f64 on the host); w: point size, px
  rel: vec4f,
  // xy: viewport px; z: projection y scale (P11); w: largest adaptive size, px
  view: vec4f,
  // x: colour mode (0 RGB, 1 intensity); y: 1 = adaptive size;
  // z: max distance from the eye, f32 bits (0 = no limit)
  mode: vec4u,
  // the nodes' axes -> the scene's (identity unless the source has a rotated
  // coordinate system)
  axes: mat3x3f,
};

@group(0) @binding(2) var<uniform> cloud: Cloud;
@group(1) @binding(0) var<storage, read> pts: array<vec4u>;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) color: vec4f,
  @location(1) rel: vec3f,
};

struct PointOut {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
  @location(2) id: vec4f,
};

const POINT_TAG = ${POINT_TAG}.0 / 255.0;

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var o: VsOut;
  let p = pts[ii + 1u];
  let local = vec3f(bitcast<f32>(p.x), bitcast<f32>(p.y), bitcast<f32>(p.z));
  let rel = cloud.axes * local + cloud.rel.xyz;
  o.rel = rel;
  let far = bitcast<f32>(cloud.mode.z);
  let too_far = far > 0.0 && frame.light.w != 1.0 && distance(rel, frame.eye.xyz) > far;
  if (too_far || clip_discard(rel + frame.origin.xyz)) {
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0); // beyond the max distance / outside the clip volume: culled
    return o;
  }
  var pos = frame.view_proj * vec4f(rel, 1.0);
  var size = cloud.rel.w;
  if (cloud.mode.y == 1u) {
    // the node's point spacing projected to px (pos.w = view depth in
    // perspective, 1 in ortho): fills the gaps of a coarse level up close
    let spacing = bitcast<f32>(pts[0].x);
    let px = spacing * cloud.view.z * cloud.view.y * 0.5 / max(pos.w, 1e-6);
    size = max(size, min(px, cloud.view.w));
  }
  // corners of two triangles: (-,-) (+,-) (+,+) | (-,-) (+,+) (-,+)
  let cx = select(-1.0, 1.0, vi == 1u || vi == 2u || vi == 4u);
  let cy = select(-1.0, 1.0, vi == 2u || vi == 4u || vi == 5u);
  pos.x += cx * size / cloud.view.x * pos.w;
  pos.y += cy * size / cloud.view.y * pos.w;
  o.clip = pos;
  let rgb = vec3f(f32(p.w & 255u), f32((p.w >> 8u) & 255u), f32((p.w >> 16u) & 255u)) / 255.0;
  let grey = f32(p.w >> 24u) / 255.0;
  o.color = vec4f(select(rgb, vec3f(grey), cloud.mode.x == 1u), 1.0);
  return o;
}

@fragment
fn fs(in: VsOut) -> PointOut {
  // camera-facing normal: from the eye (perspective) or the view axis (ortho)
  var n: vec3f;
  if (frame.light.w == 1.0) {
    n = frame.light.xyz;
  } else {
    n = normalize(frame.eye.xyz - in.rel);
  }
  var o: PointOut;
  // scene alpha = unlit luma (the edge pass's white-on-dark test, sketch fill)
  o.color = vec4f(in.color.rgb, dot(in.color.rgb, vec3f(0.299, 0.587, 0.114)));
  o.normal = vec4f(n * 0.5 + 0.5, POINT_TAG);
  o.id = vec4f(0.0);
  return o;
}
`;
}
