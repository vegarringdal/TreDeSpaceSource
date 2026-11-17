// Laser-scan points (.tdpp): one screen-aligned square per point, expanded
// from a per-node storage buffer (instance = point, a 4-vertex triangle strip:
// the vertex stage is what a cloud costs, and a strip runs it 4 times a point
// where two listed triangles ran it 6).
// Drawn opaque in the last scene pass before the helper overlays, depth
// written and tested like the model (reversed-Z), honouring the clip system.
// The colour is the scan's own (photographic, so unlit); the G-buffer gets a
// camera-facing normal and the tag bits "edges off" (a cloud would otherwise
// light up with depth edges between neighbouring points), "carries colour"
// and the helper bit (sketch mode keeps the points' colour on the paper).
import { clipWgsl, HELPER_TAG_BIT } from './scene';

/** Node buffer layout (pointsLayer.ts): 16 header words, all f32 bits — the
 *  centre of the node's cube (x, y, z), the node's own spacing, the point
 *  spacing to size by in each of the cube's 8 octants (x | y << 1 | z << 2,
 *  the file's child order), then the quantization base (x, y, z, relative to
 *  the cloud origin) and unit — then 3 words (12 bytes) per point:
 *    word 0: qx (18 bits) | qy low 14 bits << 18
 *    word 1: qy high 4 bits | qz (18 bits) << 4 | setup (8 bits) << 22
 *    word 2: r | g << 8 | b << 16 | intensity8 << 24
 *  position = base + q · unit. 18 bits are 262 m on the cook's 1 mm grid, so
 *  a node up to that size is stored exactly; a larger one (the top levels of
 *  a big site) gets a coarser unit, far below its own point spacing. */
export const POINT_WORDS = 3;
export const POINT_HEADER_WORDS = 16;
/** Header word of the first octant spacing, and how many there are. */
export const POINT_OCTANT_WORD = 4;
export const POINT_OCTANTS = 8;
/** Header words of the quantization base (3) and unit (1). */
export const POINT_BASE_WORD = 12;
/** Bits of one quantized coordinate, and its largest value. */
export const POINT_COORD_BITS = 18;
export const POINT_COORD_MAX = (1 << POINT_COORD_BITS) - 1;

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
@group(1) @binding(0) var<storage, read> pts: array<u32>;

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
const POINT_HEADER = ${POINT_HEADER_WORDS}u;
const POINT_WORDS = ${POINT_WORDS}u;
const POINT_OCTANT = ${POINT_OCTANT_WORD}u;
const POINT_BASE = ${POINT_BASE_WORD}u;
const COORD_MASK = ${POINT_COORD_MAX}u;

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var o: VsOut;
  let at = POINT_HEADER + ii * POINT_WORDS;
  let w0 = pts[at];
  let w1 = pts[at + 1u];
  let rgba = pts[at + 2u];
  // 18-bit grid coordinates from the node's base (see the layout above)
  let q = vec3f(f32(w0 & COORD_MASK), f32((w0 >> 18u) | ((w1 & 15u) << 14u)), f32((w1 >> 4u) & COORD_MASK));
  let base = vec3f(bitcast<f32>(pts[POINT_BASE]), bitcast<f32>(pts[POINT_BASE + 1u]), bitcast<f32>(pts[POINT_BASE + 2u]));
  let local = base + q * bitcast<f32>(pts[POINT_BASE + 3u]);
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
    // the point spacing where this point lies, projected to px (pos.w = view
    // depth in perspective, 1 in ortho): fills the gaps of a coarse level up
    // close. It is the spacing of the finest level drawn in the point's octant
    // of the node — the node's own only where no child is drawn — so a coarse
    // node's points do not cover the finer ones around them.
    let octant = u32(local.x >= bitcast<f32>(pts[0]))
      | (u32(local.y >= bitcast<f32>(pts[1])) << 1u)
      | (u32(local.z >= bitcast<f32>(pts[2])) << 2u);
    let spacing = bitcast<f32>(pts[POINT_OCTANT + octant]);
    let px = spacing * cloud.view.z * cloud.view.y * 0.5 / max(pos.w, 1e-6);
    size = max(size, min(px, cloud.view.w));
  }
  // corners of the strip: (-,-) (+,-) (-,+) (+,+)
  let cx = select(-1.0, 1.0, (vi & 1u) != 0u);
  let cy = select(-1.0, 1.0, (vi & 2u) != 0u);
  pos.x += cx * size / cloud.view.x * pos.w;
  pos.y += cy * size / cloud.view.y * pos.w;
  o.clip = pos;
  let rgb = vec3f(f32(rgba & 255u), f32((rgba >> 8u) & 255u), f32((rgba >> 16u) & 255u)) / 255.0;
  let grey = f32(rgba >> 24u) / 255.0;
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
