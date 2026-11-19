// Index-buffer width conversion (drawLayout.ts IndexWidth): the vertex-pull
// paths read u8 meshlet-local indices from storage, MDI needs a u16 hardware
// index buffer. Models are uploaded at u8 and converted on the GPU when the
// draw path crosses MDI, so no CPU copy of the indices has to be kept.
//
// One invocation per OUTPUT word. A 2D dispatch carries buffers past the
// 65 535-workgroup limit of one dimension: the flat index is
// gid.y * (num_workgroups.x * 64) + gid.x.

import type { IndexWidth } from '../drawLayout';

/** Workgroup width of the conversion kernels. */
export const INDEX_WIDTH_WORKGROUP = 64;

/** Converter from the `from` width into the other one. Widening writes one
 *  u16 pair per word (half a source word); narrowing packs four u8 from two
 *  source words, reading past the source end as zero. */
export function indexWidthWgsl(from: IndexWidth): string {
  const body =
    from === 1
      ? /* wgsl */ `  let word = src[j >> 1u] >> ((j & 1u) * 16u);
  dst[j] = (word & 0xffu) | (((word >> 8u) & 0xffu) << 16u);`
      : /* wgsl */ `  let n = arrayLength(&src);
  var a = 0u;
  var b = 0u;
  if (2u * j < n) { a = src[2u * j]; }
  if (2u * j + 1u < n) { b = src[2u * j + 1u]; }
  dst[j] = (a & 0xffu) | (((a >> 16u) & 0xffu) << 8u) | ((b & 0xffu) << 16u) | (((b >> 16u) & 0xffu) << 24u);`;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;

@compute @workgroup_size(${INDEX_WIDTH_WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let j = gid.y * groups.x * ${INDEX_WIDTH_WORKGROUP}u + gid.x;
  if (j >= arrayLength(&dst)) { return; }
${body}
}
`;
}
