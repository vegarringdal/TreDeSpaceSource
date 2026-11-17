// Scan photo (a laser-scan setup's cube map or spherical image) composited
// after post.
//
// Fullscreen triangle: each pixel's world ray (unjittered camera basis) is
// rotated into the setup frame, the cube face is picked by the dominant axis
// and the ray projected through that face's 90° pinhole camera. Face order
// and cameras follow the .tdpp / LGSX convention (scan-cook docs): faces 0..5
// look along +Y, −Y, −X, +X, +Z, −Z of the setup frame; a face camera looks
// down its local −Z with +X right and +Y up, so its coordinates are
// c = R_faceᵀ·d and uv = (½ + ½·cx/−cz, ½ − ½·cy/−cz).
//
// The six faces are separate textures so each can have its own resolution
// (the faces in view are sharpened on zoom). A spherical photo (E57
// equirectangular image) is used instead when its azimuth span is non-zero:
// column = ½ − azimuth / span, row = ½ − elevation / span, azimuth measured
// from +X toward +Y; outside the image's range nothing is drawn.
//
// mode 0 = background: only where the scene left depth at the clear value
// (reversed-Z 0 — no geometry); mode 1 = over: everywhere, blended by the
// opacity on top of the render (the real-vs-design crossfade).

/** WGSL for the pano pass; `msaa` selects the multisampled depth binding. */
export function panoWgsl(msaa: boolean): string {
  const depthType = msaa ? 'texture_depth_multisampled_2d' : 'texture_depth_2d';
  return /* wgsl */ `
struct PanoUni {
  right: vec4f, // world screen-right, w = tan(fovX / 2)
  up: vec4f, // world screen-up, w = tan(fovY / 2)
  fwd: vec4f, // world view direction, w = opacity
  r0: vec4f, // rows of world → photo-frame rotation; r0.w = mode
  r1: vec4f, // r1.w = sphere azimuth span, radians (0 = cube photo)
  r2: vec4f, // r2.w = sphere elevation span, radians
};

@group(0) @binding(0) var<uniform> u: PanoUni;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var depthTex: ${depthType};
@group(0) @binding(3) var face0: texture_2d<f32>;
@group(0) @binding(4) var face1: texture_2d<f32>;
@group(0) @binding(5) var face2: texture_2d<f32>;
@group(0) @binding(6) var face3: texture_2d<f32>;
@group(0) @binding(7) var face4: texture_2d<f32>;
@group(0) @binding(8) var face5: texture_2d<f32>;
@group(0) @binding(9) var sphere: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var o: VsOut;
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.ndc = xy;
  return o;
}

// (u, v, layer) for a setup-frame direction.
fn faceUv(d: vec3f) -> vec3f {
  let a = abs(d);
  var c: vec3f;
  var layer: f32;
  if (a.x >= a.y && a.x >= a.z) {
    if (d.x > 0.0) {
      layer = 3.0;
      c = vec3f(-d.y, d.z, -d.x);
    } else {
      layer = 2.0;
      c = vec3f(d.y, d.z, d.x);
    }
  } else if (a.y >= a.z) {
    if (d.y > 0.0) {
      layer = 0.0;
      c = vec3f(d.x, d.z, -d.y);
    } else {
      layer = 1.0;
      c = vec3f(-d.x, d.z, d.y);
    }
  } else {
    if (d.z > 0.0) {
      layer = 4.0;
      c = vec3f(d.x, -d.y, -d.z);
    } else {
      layer = 5.0;
      c = d;
    }
  }
  let k = 0.5 / max(-c.z, 1e-6);
  return vec3f(clamp(vec2f(0.5 + c.x * k, 0.5 - c.y * k), vec2f(0.0), vec2f(1.0)), layer);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let depth = textureLoad(depthTex, vec2i(floor(in.pos.xy)), 0);
  if (u.r0.w < 0.5 && depth > 1e-9) {
    discard;
  }
  let d = normalize(u.fwd.xyz + in.ndc.x * u.right.w * u.right.xyz + in.ndc.y * u.up.w * u.up.xyz);
  let ds = vec3f(dot(u.r0.xyz, d), dot(u.r1.xyz, d), dot(u.r2.xyz, d));
  var rgb: vec3f;
  if (u.r1.w > 0.0) {
    let uv = vec2f(0.5 - atan2(ds.y, ds.x) / u.r1.w, 0.5 - asin(clamp(ds.z, -1.0, 1.0)) / u.r2.w);
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
      discard; // outside what the image covers
    }
    rgb = textureSampleLevel(sphere, samp, uv, 0.0).rgb;
  } else {
    let t = faceUv(ds);
    switch (i32(t.z)) {
      case 0 { rgb = textureSampleLevel(face0, samp, t.xy, 0.0).rgb; }
      case 1 { rgb = textureSampleLevel(face1, samp, t.xy, 0.0).rgb; }
      case 2 { rgb = textureSampleLevel(face2, samp, t.xy, 0.0).rgb; }
      case 3 { rgb = textureSampleLevel(face3, samp, t.xy, 0.0).rgb; }
      case 4 { rgb = textureSampleLevel(face4, samp, t.xy, 0.0).rgb; }
      default { rgb = textureSampleLevel(face5, samp, t.xy, 0.0).rgb; }
    }
  }
  return vec4f(rgb, u.fwd.w);
}
`;
}
