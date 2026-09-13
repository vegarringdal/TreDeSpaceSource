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
