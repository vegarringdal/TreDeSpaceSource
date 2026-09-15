// Depth pick: one workgroup reads the depth under the cursor straight from
// the scene depth target — multisampled or not — and writes it to a one-word
// storage buffer the renderer copies into its readback buffer. Reversed-Z, so
// the NEAREST surface covering the pixel is the max over the samples: an edge
// pixel resolves to the object, not to what is behind it. (The HZB mip 0 this
// replaced was a min over a 2×2 block — the farthest surface — so silhouette
// picks landed on the background and slanted faces were off by a pixel plus
// depth slope.)
export function pickDepthWgsl(msaa: boolean): string {
  return /* wgsl */ `
@group(0) @binding(0) var src: ${msaa ? 'texture_multisampled_2d<f32>' : 'texture_2d<f32>'};
@group(0) @binding(1) var<uniform> pick: vec4u;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;

@compute @workgroup_size(1)
fn main() {
  let c = min(pick.xy, textureDimensions(src) - 1u);
  var d = 0.0;
${
  msaa
    ? `  for (var s = 0u; s < textureNumSamples(src); s++) {
    d = max(d, textureLoad(src, c, i32(s)).x);
  }`
    : `  d = textureLoad(src, c, 0).x;`
}
  out[0] = d;
}
`;
}

/** Item pick, fast path: read the packed item id the main pass ALREADY wrote
 *  into the G-buffer id target under the cursor, instead of replaying the
 *  scene through the pick pipelines. Under MSAA the winning sample is the one
 *  nearest the camera (reversed-Z, so max depth) — the same rule pickDepthWgsl
 *  uses, so an edge pixel resolves to the object rather than to what is behind
 *  it. Only valid while nothing in the scene is transparent; ItemPickPass owns
 *  that guard and falls back to the replay otherwise. */
export function pickItemIdWgsl(msaa: boolean): string {
  return /* wgsl */ `
@group(0) @binding(0) var ids: ${msaa ? 'texture_multisampled_2d<f32>' : 'texture_2d<f32>'};
${msaa ? '@group(0) @binding(1) var depth: texture_multisampled_2d<f32>;\n' : ''}@group(0) @binding(2) var<uniform> pick: vec4u;
@group(0) @binding(3) var<storage, read_write> out: array<u32>;

@compute @workgroup_size(1)
fn main() {
  let c = min(pick.xy, textureDimensions(ids) - 1u);
${
  msaa
    ? `  var best = -1.0;
  var px = vec4f(0.0);
  for (var s = 0u; s < textureNumSamples(ids); s++) {
    let d = textureLoad(depth, c, i32(s)).x;
    if (d > best) {
      best = d;
      px = textureLoad(ids, c, i32(s));
    }
  }`
    : `  let px = textureLoad(ids, c, 0);`
}
  // the id was written as four f32(byte)/255 channels through rgba8unorm
  let v = vec4u(round(px * 255.0));
  out[0] = v.x | (v.y << 8u) | (v.z << 16u) | (v.w << 24u);
}
`;
}
