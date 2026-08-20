// VBAO compute — port of the native vbao.slang (Visibility Bitmask AO,
// Therrien/Levesque/Gilet 2023). Screen-space horizon bitmask per slice;
// view-space positions reconstructed from reversed-Z infinite depth.
// Temporal accumulation via lerp(history, raw, blend) into a read_write
// history image, exactly like native.
export function vbaoWgsl(msaa: boolean): string {
  return /* wgsl */ `
struct AoParams {
  inv_size: vec2f,
  radius: f32,
  bias: f32,
  seed: u32,
  slices: u32,
  samples: u32,
  blend: f32,
  near: f32,
  thickness: f32,
  p00: f32,
  p11: f32,
  ortho: u32,       // 1 = orthographic
  ortho_half_h: f32,
  ortho_near: f32,  // ortho depth slab
  ortho_far: f32,
};

@group(0) @binding(0) var depth_tex: ${msaa ? 'texture_multisampled_2d<f32>' : 'texture_2d<f32>'};
@group(0) @binding(1) var ao_out: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var ao_hist: texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var<uniform> ap: AoParams;

const PI = 3.14159265;
const HALF_PI = 1.57079633;
const NB = 32u;

fn ld_depth(px: vec2i, size: vec2i) -> f32 {
  return textureLoad(depth_tex, clamp(px, vec2i(0), size - 1), 0).x;
}

// View-space position from UV + depth, z positive into scene.
// Perspective: reversed-Z infinite far. Ortho: linear depth over the slab,
// constant lateral extent (native vbao.slang ViewPos).
fn view_pos(uv: vec2f, raw: f32) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, -(uv.y * 2.0 - 1.0));
  if (ap.ortho == 1u) {
    let z = ap.ortho_far - raw * (ap.ortho_far - ap.ortho_near);
    let half_w = ap.ortho_half_h * (ap.inv_size.y / ap.inv_size.x);
    return vec3f(ndc.x * half_w, ndc.y * ap.ortho_half_h, z);
  }
  let z = ap.near / max(raw, 1e-7);
  return vec3f(ndc.x * z / ap.p00, ndc.y * z / ap.p11, z);
}

fn hash(pixel: vec2u, seed: u32) -> f32 {
  var n = (pixel.x * 2185031351u) ^ (pixel.y * 3758974893u) ^ (seed * 1361640981u);
  n ^= n >> 16u; n *= 0x45d9f3bu; n ^= n >> 16u;
  return f32(n & 0x00FFFFFFu) / f32(0x01000000u);
}

// Mark bitmask sectors from a to a+b-1 (Algorithm 1 line 19).
fn update_sectors(minH: f32, maxH: f32, bitmask: u32) -> u32 {
  let a = u32(minH * f32(NB));
  let b = u32(ceil((maxH - minH) * f32(NB)));
  var angle_bit = 0u;
  if (b > 0u) { angle_bit = 0xFFFFFFFFu >> (NB - min(b, NB)); }
  return bitmask | (angle_bit << min(a, NB - 1u));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2i(vec2f(1.0) / ap.inv_size + 0.5);
  let pixel = vec2i(gid.xy);
  if (pixel.x >= size.x || pixel.y >= size.y) { return; }

  let uv = (vec2f(pixel) + 0.5) * ap.inv_size;
  let raw_depth = ld_depth(pixel, size);
  if (raw_depth <= 0.0) {
    textureStore(ao_out, gid.xy, vec4f(1.0));
    textureStore(ao_hist, gid.xy, vec4f(1.0));
    return;
  }

  let p_vs = view_pos(uv, raw_depth);
  let cam_to_surface = normalize(p_vs);
  let z_view = p_vs.z;
  // screen-space sampling radius in pixels (ortho: constant px per metre)
  var sr_px: f32;
  if (ap.ortho == 1u) {
    sr_px = clamp(ap.radius * 0.5 / (ap.ortho_half_h * ap.inv_size.y), 4.0, 48.0);
  } else {
    sr_px = clamp(ap.radius / z_view * (0.5 / ap.inv_size.y) * ap.p11, 4.0, 48.0);
  }

  // View-space normal from minimum-depth-difference neighbours (stays on the
  // same surface instead of jumping across discontinuities).
  var d_r = ld_depth(pixel + vec2i(1, 0), size);
  var d_l = ld_depth(pixel + vec2i(-1, 0), size);
  var d_d = ld_depth(pixel + vec2i(0, 1), size);
  var d_u = ld_depth(pixel + vec2i(0, -1), size);
  if (d_r <= 0.0) { d_r = raw_depth; }
  if (d_l <= 0.0) { d_l = raw_depth; }
  if (d_d <= 0.0) { d_d = raw_depth; }
  if (d_u <= 0.0) { d_u = raw_depth; }
  var dx_vec: vec3f;
  var dy_vec: vec3f;
  if (abs(d_r - raw_depth) <= abs(d_l - raw_depth)) {
    dx_vec = view_pos(uv + vec2f(ap.inv_size.x, 0.0), d_r) - p_vs;
  } else {
    dx_vec = -(view_pos(uv + vec2f(-ap.inv_size.x, 0.0), d_l) - p_vs);
  }
  if (abs(d_d - raw_depth) <= abs(d_u - raw_depth)) {
    dy_vec = view_pos(uv + vec2f(0.0, ap.inv_size.y), d_d) - p_vs;
  } else {
    dy_vec = -(view_pos(uv + vec2f(0.0, -ap.inv_size.y), d_u) - p_vs);
  }
  let n_raw = cross(dx_vec, dy_vec);
  let n_len = length(n_raw);
  var n_vs = vec3f(0.0, 0.0, -1.0);
  if (n_len > 1e-6) { n_vs = n_raw / n_len; }
  if (n_vs.z > 0.0) { n_vs = -n_vs; }

  let jitter = hash(gid.xy, ap.seed);
  let jitter2 = hash(gid.xy, ap.seed ^ 0xDEADBEEFu);

  var total_occluded = 0u;
  for (var s = 0u; s < ap.slices; s++) {
    let phi = (f32(s) + jitter) * (2.0 * PI) / f32(ap.slices);
    let dir_px = vec2f(cos(phi), sin(phi));
    var bi = 0u;

    for (var j = 0u; j < ap.samples; j++) {
      // squared step distribution: dense near the surface
      let t_lin = (f32(j) + 0.5 + jitter2 * 0.6) / f32(ap.samples);
      let step_px = t_lin * t_lin * sr_px;
      if (step_px < 3.0) { continue; }

      let s_uv = saturate(uv + dir_px * step_px * ap.inv_size);
      let s_px = clamp(vec2i(s_uv / ap.inv_size), vec2i(0), size - 1);
      let s_depth = ld_depth(s_px, size);
      if (s_depth <= 0.0) { continue; }

      let sf_uv = (vec2f(s_px) + 0.5) * ap.inv_size;
      let sf = view_pos(sf_uv, s_depth);
      let sb = sf - cam_to_surface * ap.thickness; // back of the occluder slab

      let df = sf - p_vs;
      let db = sb - p_vs;
      let df_len = length(df);
      let db_len = length(db);
      if (df_len < 0.005 || df_len > ap.radius * 2.2) { continue; }

      // elevation above the tangent plane; the bias gate removes self-occlusion
      let ef = dot(df / df_len, n_vs);
      var eb = ef;
      if (db_len > 1e-4) { eb = dot(db / db_len, n_vs); }
      if (ef < ap.bias) { continue; }
      eb = max(eb, 0.0);

      let thetaF = (asin(clamp(ef, -1.0, 1.0)) + HALF_PI) / PI;
      let thetaB = (asin(clamp(eb, -1.0, 1.0)) + HALF_PI) / PI;
      bi = update_sectors(min(thetaF, thetaB), max(thetaF, thetaB), bi);
    }
    total_occluded += countOneBits(bi);
  }

  // only the above-tangent hemisphere (16 of 32 sectors) is ever set
  let ao_raw = 1.0 - saturate(f32(total_occluded) / f32(ap.slices * (NB / 2u)));
  let hist = textureLoad(ao_hist, gid.xy).x;
  let ao_acc = mix(hist, ao_raw, ap.blend);
  textureStore(ao_out, gid.xy, vec4f(ao_acc));
  textureStore(ao_hist, gid.xy, vec4f(ao_acc));
}
`;
}

// Fullscreen post pass: edge detect ported from the native edge.slang /
// edge_msaa.slang + accumulation TAA ported from taa.slang (edges applied
// BEFORE accumulation, matching the native order Mesh -> Edge -> TAA).
//
// Both paths render a full G-buffer (normal rgba8unorm, item id packed into
// rgba8unorm — WebGPU cannot multisample integer formats). Non-MSAA runs the
// detectors once per pixel; MSAA runs them PER SAMPLE and emits fractional
// line coverage (2 of 4 samples cross -> 0.5 alpha), the edge_msaa.slang
// scheme, so all edge types stay antialiased. Per-pixel logic (fade,
// white-on-dark, debug views, TAA) uses sample 0 / the resolved scene color.
// MRT: target 0 = display (sum / count), target 1 = clean history sum (RGBA16F).
export function postWgsl(msaa: boolean): string {
  const gtex = msaa ? 'texture_multisampled_2d<f32>' : 'texture_2d<f32>';
  return /* wgsl */ `
struct PostParams {
  frame_idx: u32,
  accum_count: u32,
  // 1 geo edges, 2 item edges, 4 taa, 8 white-on-dark; bits 4-6 debug view;
  // 1024 hold; 2048 sketch; 4096 smooth-mesh edges OFF; 8192 flat-mesh edges
  // OFF; 16384 sketch respects the edge-off switches; 32768 sketch colour
  // fill (mesh colours washed onto the paper); 65536 sketch coloured edges
  // (the ink takes the mesh colour)
  flags: u32,
  cam_near: f32,
  edge_color: vec4f,
  depth_thr: f32,
  normal_thr: f32,
  fade_exp: f32,
  dark_thr: f32,
  ao_strength: f32,
  ortho_near: f32, // ortho depth slab (flags bit 512 = orthographic)
  ortho_far: f32,
  focus_dist: f32, // camera->target distance: ortho edge-fade floor
  // separate edge tuning for meshes with AUTHORED normals (G-buffer tag 0.5)
  sm_depth_thr: f32,
  sm_normal_thr: f32,
  sm_fade_exp: f32,
  _pad: f32,
};

const SAMPLES = ${msaa ? 4 : 1};

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var depth_tex: ${gtex};
@group(0) @binding(2) var<uniform> pp: PostParams;
@group(0) @binding(3) var history: texture_2d<f32>;
@group(0) @binding(4) var normal_tex: ${gtex};
@group(0) @binding(5) var id_tex: ${gtex};
@group(0) @binding(6) var ao_tex: texture_2d<f32>; // VBAO output (always single-sample)

// The third textureLoad arg is the sample index for multisampled textures and
// the mip level otherwise; with SAMPLES = 1 the loop only ever passes 0, so
// the same loader bodies compile for both variants.
fn ld_depth(xy: vec2i, o: vec2i, dims: vec2i, s: i32) -> f32 {
  return textureLoad(depth_tex, clamp(xy + o, vec2i(0), dims - 1), s).x;
}
fn ld_normal(xy: vec2i, o: vec2i, dims: vec2i, s: i32) -> vec3f {
  return textureLoad(normal_tex, clamp(xy + o, vec2i(0), dims - 1), s).xyz * 2.0 - 1.0;
}
fn ld_id(xy: vec2i, o: vec2i, dims: vec2i, s: i32) -> u32 {
  let t = vec4u(round(textureLoad(id_tex, clamp(xy + o, vec2i(0), dims - 1), s) * 255.0));
  return t.x | (t.y << 8u) | (t.z << 16u) | (t.w << 24u);
}

// Linear view distance from raw depth in either projection.
fn lin_z(raw: f32) -> f32 {
  if ((pp.flags & 512u) != 0u) {
    return pp.ortho_far - raw * (pp.ortho_far - pp.ortho_near);
  }
  return pp.cam_near / max(raw, 1e-6);
}

// Comparable depth for the edge fade (edge.slang cmp_depth): ~near/dist with
// 1 = nearest. Ortho is linearised and floored at the focus distance so edge
// brightness stays stable as the camera plane slices through geometry.
fn cmp_depth(raw: f32) -> f32 {
  if ((pp.flags & 512u) != 0u) {
    let vd = pp.ortho_far - raw * (pp.ortho_far - pp.ortho_near);
    return pp.cam_near / max(vd, pp.focus_dist);
  }
  return raw;
}

// Depth heat-map from the native edge.slang HZB visualiser:
// black (far/background) -> blue -> cyan -> green -> yellow -> red (near).
fn heat(vis_in: f32) -> vec3f {
  let vis = saturate(vis_in);
  if (vis < 0.001) { return vec3f(0.04, 0.04, 0.10); }
  var a: vec3f; var b: vec3f; var s: f32;
  if (vis < 0.25) { a = vec3f(0.0, 0.0, 0.5); b = vec3f(0.0, 0.0, 1.0); s = vis / 0.25; }
  else if (vis < 0.5) { a = vec3f(0.0, 0.0, 1.0); b = vec3f(0.0, 1.0, 1.0); s = (vis - 0.25) / 0.25; }
  else if (vis < 0.75) { a = vec3f(0.0, 1.0, 1.0); b = vec3f(1.0, 1.0, 0.0); s = (vis - 0.5) / 0.25; }
  else { a = vec3f(1.0, 1.0, 0.0); b = vec3f(1.0, 0.0, 0.0); s = (vis - 0.75) / 0.25; }
  return mix(a, b, s);
}

fn id_hash_color(id: u32) -> vec3f {
  if (id == 0u) { return vec3f(0.08); }
  var h = id;
  h = (h ^ 61u) ^ (h >> 16u);
  h *= 9u; h ^= h >> 4u; h *= 0x27d4eb2du; h ^= h >> 15u;
  return vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
}

struct PostOut {
  @location(0) display: vec4f,
  @location(1) history: vec4f,
};

@fragment
fn fs(@builtin(position) fpos: vec4f) -> PostOut {
  let dims = vec2i(textureDimensions(scene));
  let xy = vec2i(fpos.xy);
  // hold mode (flag 1024): overlay-only frame after convergence (outline hover/
  // pulse) — re-present the accumulated sum untouched instead of adding another
  // sample, so animated overlays never brighten or reset the converged scene
  if ((pp.flags & 1024u) != 0u) {
    let sum = textureLoad(history, xy, 0);
    var hold: PostOut;
    hold.display = vec4f(saturate(sum.rgb / f32(max(pp.accum_count, 1u))), 1.0);
    hold.history = sum;
    return hold;
  }
  let scene_px = textureLoad(scene, xy, 0);
  var col = scene_px.rgb;

  let depth_c0 = ld_depth(xy, vec2i(0, 0), dims, 0);

  // VBAO: bilateral 5x5 blur weighted by linear-depth similarity (edge.slang
  // port) — rejects taps >1 m away so AO doesn't bleed across depth edges.
  var ao = 1.0;
  if ((pp.flags & 256u) != 0u) {
    let center_z = lin_z(depth_c0);
    var acc = 0.0;
    var tw = 0.0;
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        let td = ld_depth(xy, vec2i(dx, dy), dims, 0);
        let tap_z = lin_z(td);
        if (abs(tap_z - center_z) < 1.0) {
          let t = clamp(xy + vec2i(dx, dy), vec2i(0), dims - 1);
          acc += textureLoad(ao_tex, t, 0).x;
          tw += 1.0;
        }
      }
    }
    if (tw > 0.0) { ao = acc / tw; }
    col *= mix(1.0, ao, pp.ao_strength);
  }

  // per-model edge tag from the G-buffer normal alpha (see RENDER_FS):
  // 0 = flat mesh, 0.5 = authored normals (own thresholds), 1 = edges off.
  // The 0.25/0.75 cuts are decoder constants for DISCRETE states — a future
  // opt-in mode may re-encode this byte as a continuous per-model edge
  // STRENGTH instead (DESIGN.md "Per-model edge tag / edge strength").
  let gtag = textureLoad(normal_tex, xy, 0).w;
  let smooth_mesh = gtag > 0.25 && gtag < 0.75;
  let use_depth_thr = select(pp.depth_thr, pp.sm_depth_thr, smooth_mesh);
  let use_normal_thr = select(pp.normal_thr, pp.sm_normal_thr, smooth_mesh);
  let use_fade_exp = select(pp.fade_exp, pp.sm_fade_exp, smooth_mesh);

  // depth-based edge fade: comparable depth ~ near/dist, 1 = near
  let edge_fade = pow(saturate(cmp_depth(depth_c0)), use_fade_exp);
  let cull = max(edge_fade, 0.04); // distance culling of weak creases

  // Detectors run per sample; fractional coverage antialiases the lines
  // (edge_msaa.slang scheme; with SAMPLES = 1 this is plain edge.slang).
  var geo_cov = 0.0;
  var item_cov = 0.0;
  for (var s = 0; s < SAMPLES; s++) {
    if ((pp.flags & 1u) != 0u) {
      // geometry edges: single-sided forward differences (+x, +y) -> 1px lines
      let d_c = ld_depth(xy, vec2i(0, 0), dims, s);
      let gx = ld_depth(xy, vec2i(1, 0), dims, s) - d_c;
      let gy = ld_depth(xy, vec2i(0, 1), dims, s) - d_c;
      let depth_edge = 4.0 * sqrt(gx * gx + gy * gy);
      let n_c = ld_normal(xy, vec2i(0, 0), dims, s);
      let normal_edge = max(
        saturate(1.0 - dot(n_c, ld_normal(xy, vec2i(1, 0), dims, s))),
        saturate(1.0 - dot(n_c, ld_normal(xy, vec2i(0, 1), dims, s))),
      );
      geo_cov += saturate(
        step(use_depth_thr, depth_edge * cull) +
        step(use_normal_thr, normal_edge * cull)
      );
    }
    if ((pp.flags & 2u) != 0u) {
      // item edges: only the higher-id side of a boundary fires -> 1px lines;
      // background id 0 loses to everything, giving object silhouettes
      let id_c = ld_id(xy, vec2i(0, 0), dims, s);
      if (id_c != 0u) {
        let id_r = ld_id(xy, vec2i(1, 0), dims, s);
        let id_l = ld_id(xy, vec2i(-1, 0), dims, s);
        let id_d = ld_id(xy, vec2i(0, 1), dims, s);
        let id_u = ld_id(xy, vec2i(0, -1), dims, s);
        if ((id_r != id_c && id_c > id_r) || (id_l != id_c && id_c > id_l) ||
            (id_d != id_c && id_c > id_d) || (id_u != id_c && id_c > id_u)) {
          item_cov += 1.0;
        }
      }
    }
  }
  let geo_edge = geo_cov / f32(SAMPLES);
  let item_edge = item_cov / f32(SAMPLES);

  // debug buffer views (native edge.slang bits): 1 normal, 2 depth, 3 item id, 4 raw edge
  let debug_view = (pp.flags >> 4u) & 7u;
  if (debug_view != 0u) {
    var dbg = vec3f(0.0);
    if (debug_view == 1u) {
      dbg = ld_normal(xy, vec2i(0, 0), dims, 0) * 0.5 + 0.5;
    } else if (debug_view == 2u) {
      var vis = 0.0;
      if (depth_c0 > 1e-7 && pp.cam_near > 0.0) {
        vis = saturate(1.0 - log2(1.0 + lin_z(depth_c0)) / 17.0);
      }
      dbg = heat(vis);
    } else if (debug_view == 3u) {
      dbg = id_hash_color(ld_id(xy, vec2i(0, 0), dims, 0));
    } else if (debug_view == 4u) {
      let e = saturate(max(geo_edge, item_edge) * edge_fade);
      dbg = vec3f(e);
    } else if (debug_view == 5u) {
      dbg = vec3f(ao); // blurred AO buffer, greyscale
    }
    var dout: PostOut;
    dout.display = vec4f(dbg, 1.0);
    dout.history = vec4f(dbg, 1.0);
    return dout;
  }

  // composite: max() so geo+item edges don't double to 2px at boundaries.
  // Models imported with "edge lines" off tag the normal G-buffer alpha —
  // their pixels skip the edge composite (sketch mode ignores the tag, or a
  // no-edge mesh would vanish into the white paper entirely).
  let edge_raw = saturate(max(geo_edge, item_edge) * edge_fade);
  // edge-off switches: the per-asset tag (gtag 1) plus the global per-category
  // settings (flat / smooth-mesh edge lines in Settings -> Edges)
  let cat_off = select((pp.flags & 8192u) != 0u, (pp.flags & 4096u) != 0u, smooth_mesh);
  let edges_off = gtag > 0.75 || cat_off;
  let edge = select(edge_raw, 0.0, edges_off);
  if ((pp.flags & 2048u) != 0u) {
    // sketch mode: white paper + edge lines in the sketch edge color — the
    // scene color (and AO) is discarded entirely, only the edge signal draws.
    // By default sketch IGNORES the edge-off switches (a no-edge mesh would
    // vanish into the paper); flag 16384 makes it respect them.
    let sketch_edge = select(edge_raw, edge, (pp.flags & 16384u) != 0u);
    var paper = vec3f(1.0);
    var ink = pp.edge_color.rgb;
    if ((pp.flags & (32768u | 65536u)) != 0u && depth_c0 > 1e-7) {
      // colour from mesh — fill (32768): coloured surfaces get a pastel wash
      // of the shaded colour; edges (65536): the INK takes the mesh hue
      // instead, normalized to a fixed darkness so lit and shadowed runs of
      // one pipe draw the same line colour. Either way only surfaces that
      // actually carry colour participate — colourless meshes (white, grey,
      // black) keep plain paper + the sketch ink, as if uncoloured.
      // RELATIVE chroma, so a coloured mesh in shadow still counts as
      // coloured while a shaded white one never does.
      let fill = col;
      let mx = max(fill.r, max(fill.g, fill.b));
      let mn = min(fill.r, min(fill.g, fill.b));
      if (mx - mn > 0.1 * max(mx, 1e-4)) {
        if ((pp.flags & 32768u) != 0u) {
          paper = mix(vec3f(1.0), fill, 0.45);
        } else {
          ink = fill * (0.55 / max(mx, 1e-4));
        }
      }
    }
    col = mix(paper, ink, sketch_edge);
  } else {
    var active_edge_color = pp.edge_color.rgb;
    if ((pp.flags & 8u) != 0u && scene_px.a < pp.dark_thr) {
      // white edges on dark items: tested on UNLIT base luminance (scene alpha)
      active_edge_color = vec3f(1.0);
    }
    col = mix(col, active_edge_color, edge);
  }

  var out: PostOut;
  if ((pp.flags & 4u) != 0u) {
    var new_sum = vec4f(col, 1.0);
    if (pp.frame_idx != 0u) { // not the reset frame: accumulate onto history
      new_sum += textureLoad(history, xy, 0);
    }
    out.display = vec4f(saturate(new_sum.rgb / f32(max(pp.accum_count, 1u))), 1.0);
    out.history = new_sum;
  } else {
    out.display = vec4f(col, 1.0);
    out.history = vec4f(col, 1.0);
  }
  return out;
}
`;
}

// -----------------------------------------------------------------------------
// Outline effect (three.js OutlinePass port on the native hover_xray mask)
// -----------------------------------------------------------------------------
// Chain per frame (only when something is outlined):
//   mask depth (fs_outline, renderer)  →  fs_edge: 1px boundary, split into
//   visible/hidden channels by subset-vs-scene depth  →  separable blur H+V
//   (radius = thickness)  →  optional half-res wide blur pair (glow)  →
//   fs_composite: additive over the finished frame (after TAA, so hover and
//   pulse never smear into the accumulation history — native taa.slang trick).
export function outlineWgsl(msaa: boolean): string {
  const dtex = msaa ? 'texture_multisampled_2d<f32>' : 'texture_2d<f32>';
  return /* wgsl */ `
// mask/subset depth: always 1-sample; scene depth follows the scene's MSAA
@group(0) @binding(0) var mask_depth: texture_2d<f32>;
@group(0) @binding(1) var scene_depth: ${dtex};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
}

fn mask_at(xy: vec2i, dims: vec2i) -> f32 {
  return textureLoad(mask_depth, clamp(xy, vec2i(0), dims - 1), 0).x;
}

// 1px boundary of the mask, classified visible/hidden: the mask holds the
// subset's own front depth (reversed-Z), the scene depth holds whatever won
// the real depth test. Subset in front (>= scene, small tolerance for the
// 1-sample vs MSAA sample-position mismatch) = visible edge (r), otherwise
// the subset is occluded there = hidden edge (g).
@fragment
fn fs_edge(@builtin(position) fpos: vec4f) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(mask_depth));
  let xy = vec2i(fpos.xy);
  let c = mask_at(xy, dims);
  let l = mask_at(xy + vec2i(-1, 0), dims);
  let r = mask_at(xy + vec2i(1, 0), dims);
  let u = mask_at(xy + vec2i(0, -1), dims);
  let d = mask_at(xy + vec2i(0, 1), dims);
  let inside = c > 0.0;
  let n_inside = (l > 0.0) != inside || (r > 0.0) != inside ||
                 (u > 0.0) != inside || (d > 0.0) != inside;
  if (!n_inside) { return vec4f(0.0); }
  // depth of the mask side of the boundary (this pixel or the deepest-covered neighbour)
  let md = max(c, max(max(l, r), max(u, d)));
  let sd = textureLoad(scene_depth, clamp(xy, vec2i(0), dims - 1), 0).x;
  let visible = md * 1.005 >= sd;
  return vec4f(select(0.0, 1.0, visible), select(1.0, 0.0, visible), 0.0, 1.0);
}

// separable gaussian blur, radius 1-4 (three.js separable blur, MAX_RADIUS 4)
struct BlurParams {
  dir: vec2f,
  radius: f32,
  // dst→src coordinate factor: 1 = same resolution, 2 = full-res source into
  // a half-res target (the glow's first pass). Without it a half-res pass
  // reads the source 1:1 and the glow lands at DOUBLE the screen position.
  src_scale: f32,
};
@group(0) @binding(2) var blur_src: texture_2d<f32>;
@group(0) @binding(3) var<uniform> bp: BlurParams;

@fragment
fn fs_blur(@builtin(position) fpos: vec4f) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(blur_src));
  let scale = max(bp.src_scale, 1.0);
  let base = vec2i(vec2f(fpos.xy) * scale);
  let sigma = max(bp.radius * 0.5, 0.3);
  var sum = vec2f(0.0);
  var wsum = 0.0;
  for (var i = -4; i <= 4; i++) {
    if (f32(abs(i)) > bp.radius) { continue; }
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    let p = clamp(base + vec2i(bp.dir * (f32(i) * scale)), vec2i(0), dims - 1);
    sum += textureLoad(blur_src, p, 0).rg * w;
    wsum += w;
  }
  return vec4f(sum / max(wsum, 1e-4), 0.0, 1.0);
}

// additive composite over the finished frame (three.js overlay material):
// edge = strength * blurred + glow * strength * half-res wide blur.
// vis_color.a carries the pulse-modulated strength, hid_color.a the glow.
struct CompositeParams {
  vis_color: vec4f, // rgb + edge strength (pulse applied CPU-side)
  hid_color: vec4f, // rgb + glow amount
};
@group(0) @binding(4) var edge_tex: texture_2d<f32>;   // blurred, full res
@group(0) @binding(5) var glow_tex: texture_2d<f32>;   // wide blur, half res
@group(0) @binding(6) var<uniform> cp: CompositeParams;

@fragment
fn fs_composite(@builtin(position) fpos: vec4f) -> @location(0) vec4f {
  let xy = vec2i(fpos.xy);
  let dims = vec2i(textureDimensions(edge_tex));
  let gdims = vec2i(textureDimensions(glow_tex));
  let e = textureLoad(edge_tex, clamp(xy, vec2i(0), dims - 1), 0).rg;
  let g = textureLoad(glow_tex, clamp(xy / 2, vec2i(0), gdims - 1), 0).rg;
  let strength = cp.vis_color.a;
  let i2 = e * strength + g * (cp.hid_color.a * strength);
  return vec4f(cp.vis_color.rgb * i2.x + cp.hid_color.rgb * i2.y, 1.0);
}
`;
}
