// Filled marker spheres — the "solid" option of the label / measurement point
// markers: one unit sphere, instanced (centre, radius, rgba), shaded by the
// scene's headlight and alpha-blended when translucent. Drawn with the helper
// lines at the end of the last scene pass, depth tested against the model
// (reversed-Z); the G-buffer targets are masked (no edges or ids) except the
// helper tag in the normal alpha, which keeps the markers visible in sketch.
import { HELPER_FS_OUT } from './scene';

export function markerWgsl(): string {
  return /* wgsl */ `
${HELPER_FS_OUT}
struct Frame {
  // the shared Frame's leading members (camera-relative rendering): instance
  // centres are ABSOLUTE world and rebase here; eye is already rebased
  view_proj: mat4x4f,
  origin: vec4f,
  eye: vec4f,
  flags: vec4u,
  light: vec4f,
};

@group(0) @binding(0) var<uniform> frame: Frame;

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec4f,
  @location(2) rel: vec3f,
};

@vertex
fn vs(
  @location(0) pos: vec3f,    // unit-sphere vertex — also its normal
  @location(1) center: vec3f, // per instance, absolute world
  @location(2) radius: f32,
  @location(3) color: vec4f,  // rgb + opacity
) -> VsOut {
  var o: VsOut;
  let rel = center - frame.origin.xyz + pos * radius;
  o.clip = frame.view_proj * vec4f(rel, 1.0);
  o.normal = pos;
  o.color = color;
  o.rel = rel;
  return o;
}

@fragment
fn fs(in: VsOut) -> HelperOut {
  // headlight like the scene: from the eye (perspective) or along the view
  // axis (ortho); half-Lambert over an ambient floor so the far side stays legible
  var l: vec3f;
  if (frame.light.w == 1.0) {
    l = frame.light.xyz;
  } else {
    l = normalize(frame.eye.xyz - in.rel);
  }
  let t = dot(normalize(in.normal), l) * 0.5 + 0.5;
  let shade = 0.3 + 0.7 * t;
  var o: HelperOut;
  o.color = vec4f(in.color.rgb * shade, in.color.a);
  o.tag = vec4f(0.0, 0.0, 0.0, HELPER_TAG);
  return o;
}
`;
}
