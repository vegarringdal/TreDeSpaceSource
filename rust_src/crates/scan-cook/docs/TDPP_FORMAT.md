# `.tdpp` — TreDeSpace point cloud, version 1

A single-file, range-addressable point-cloud octree for the TreDeSpace
WebGPU viewer, cooked from LGSX or E57 by `scan cook` (`rust_src/crates/scan-cli`) or in the browser (`scan-wasm`). Design goals
(from `plans/E57_POINTS.md`): stream partially (HTTP Range or
OPFS reads of `(offset, length)`), resident hierarchy, additive LOD, GPU
culling per cluster, panoramas + setup poses in the same file.

All integers and floats are little-endian. Offsets are absolute file
offsets; node payloads and blobs start on 8-byte boundaries.

```text
header (128 B) | node payloads … | panorama blobs … | hierarchy | metadata JSON
```

## Header (128 bytes)

| off | type | field |
|---:|---|---|
| 0 | `[u8;4]` | magic `"TDPP"` |
| 4 | u32 | version = 1 |
| 8 | u32 | header size = 128 |
| 12 | u32 | node record size = 96 |
| 16 | u64 | file size |
| 24 | u64 | hierarchy offset |
| 32 | u32 | node count |
| 36 | u32 | nominal cluster size (256) |
| 40 | u64 | metadata offset |
| 48 | u64 | metadata size |
| 56 | u64 | point count |
| 64 | f64×3 | **origin**: position of local (0,0,0) in the file's frame (see "Frame" below) |
| 88 | f32×3 | bounds min (relative to origin) |
| 100 | f32×3 | bounds max |
| 112 | u32 | flags: 1 = colour, 2 = intensity, 4 = per-point setup index, 8 = normals, 16 = 8-bit intensity (the stored u16's low byte is 0) |
| 116 | u32 | setup count |
| 120 | — | reserved (0) |

All positions below are relative to `origin` (f32 is enough: the cook puts
the origin at the centre of the cloud). Add `origin` (f64) on the CPU, or
fold it into the view matrix.

## Hierarchy (node_count × 96 bytes)

Breadth-first: node 0 is the root; a node's children are contiguous,
ordered by octant (`x | y << 1 | z << 2`).

| off | type | field |
|---:|---|---|
| 0 | f32×3 | cube min |
| 12 | f32 | cube edge length |
| 16 | f32×3 | tight bounds min of the node's own points |
| 28 | f32×3 | tight bounds max |
| 40 | f32 | **spacing** — LOD metric (m): the spacing of the node's own points, measured from the surface they cover (see below) |
| 44 | u32 | point count (0 = structural node, no payload) |
| 48 | u32 | parent index (`0xFFFFFFFF` for the root) |
| 52 | u32 | first child index (0 when none) |
| 56 | u8 | child count |
| 57 | u8 | depth (root = 0) |
| 58 | u8 | octant within the parent |
| 59 | u8 | node flags: 1 = colour delta (the attribute stream stores `r − g, g, b − g`) |
| 60 | u32 | cluster count |
| 64 | u32 | payload size |
| 68 | u64 | payload offset |
| 76 | u64 | setup mask: bit `s` = setup `s` has points here (bit 63: `s ≥ 63`) |
| 84 | — | reserved (12 B) |

**Additive LOD**: every point is stored exactly once. A node holds a
subsample of its region; its children hold the rest. Draw a node *together
with* its loaded ancestors — refining means loading children, never
replacing. Refine while `spacing / distance · (viewport_px / (2·tan(fov/2)))`
exceeds the pixel threshold (Potree's screen-space error).

**Spacing** is measured, not assumed. `edge / √points` holds for one flat
sheet of points across the cube; a node of a real scan holds several surfaces
(both faces of a wall, a floor and what stands on it) or one that covers a
corner of the cube. The cook cuts the cube into cells several spacings wide
(a power of two per edge, about 64 points per cell on a single sheet, at most
1024 per edge), counts the occupied ones — a surface occupies one layer of
cells, so `occupied · cell²` approximates its area — and stores
`√(area / points)`. A surface oblique to the grid reads up to about 30 % wide.
Files cooked before this stored `edge / √points`, which is too small in
cluttered nodes: a viewer stops refining them while gaps still show.

## Node payload

```text
u32 point_count | u32 cluster_count | u32 pos_stream_size | u32 attr_stream_size
| u32 normal_stream_size (0 = none)
cluster_count × ClusterRecord (32 B)
position stream   — padded to 4 B
attribute stream  — padded to 4 B
normal stream     — optional, padded to 4 B
```

**ClusterRecord**: `f32 min[3]` (relative to the node's cube min),
`f32 step[3]`, `u32 first`, `u32 count`. Clusters partition the node's
points in order; each holds at most `cluster_size` points (take the counts
from the records, not from the header). They come from
`meshopt_spatialClusterPoints` (meshoptimizer 1.3), so each is spatially
compact: one cull/draw unit, like a meshlet. A cluster whose points span more
than 65535 grid units on an axis (sparse points of a coarse level, more than
65 m apart on a 1 mm grid) is cut at the middle of its longest axis until
every part fits, so the cook always writes `step` = one grid unit and
grid-aligned input is stored exactly; readers still apply `step` as given. `min` is the
cluster's tight minimum; the tight maximum is `min + max(q) · step`, taken
from the decoded points (the quantization range `65535 · step` is not a
bound).

**Streams** (meshoptimizer vertex codec, format v1 — decode with
`MeshoptDecoder.decodeVertexBuffer(out, count, stride, bytes)`, meshoptimizer
≥ 0.23, the viewer's npm 1.2 works):

* position, stride 8: `u16 qx, qy, qz, u16 intensity`
  `position = cube_min + cluster.min + q · cluster.step` (per axis).
  `intensity / 65535` is the scanner intensity in 0..1. The cook keeps the
  high 8 bits by default (header flag 16; `scan cook --intensity16` keeps
  all): the low byte of a scan's intensity is noise that costs about a byte
  per point, almost as much as the position.
* attribute, stride 4: `u8 r, g, b, setup` (setup = index into the metadata
  `setups[].index`; meaningful when flag 4 is set). The byte tells 256 setups
  apart: an E57 with more scans keeps every setup in the metadata, but the
  points of scans 256 and up are all stored as 255. In a node whose record
  has flag 1 the colour is stored as `r − g, g, b − g` (wrapping u8; add `g`
  back to the first and third byte): the channels of a scan are close to
  each other and the differences compress 15–25% better. The cook always
  writes this form; files without the node flag hold plain `r, g, b`.
* normal (flag 8, `scan cook --normals`), stride 4: `u16 ring code, u16 0`.
  Written — and the flag set — only when the source has normals (LGSX with a
  `Normal` attribute); a node without them has `normal_stream_size` 0.

### Normals: 16-bit ring code

Unit normals (source frame, z up, oriented towards the scanner) as an index
into latitude rings of constant polar spacing — exactly Leica's
`CodecNormal16PcApi`, so LGSX normals pass through losslessly:

```text
ring k = 0..=226, polar angle θ_k = k·π/226 (from +Z)
ring size s_k = max(1, ⌈452·sin θ_k⌉)            → 65 144 codes
code = Σ_{i<k} s_i + j,   φ = −π + (j + ½)·2π/s_k
n = (sin θ cos φ, sin θ sin φ, cos θ);  65535 = no normal
```

Quantization ≤ ~0.4°. `ringNormalTable()` in `src/lib/tdpp/tdppFormat.ts` builds the
65 144 × vec3 lookup (780 KB) for the CPU or a GPU storage buffer. Cost on the
Piazza sample: +1.6 B/point (16-bit octahedral would cost 3.5).

Quantization uses integer multiples of the cook grid (`metadata.grid_scale`:
1 mm), so a cluster up to 65.5 m across is lossless on that grid. LGSX
sources (also a 1 mm grid) round-trip exactly.

## Frame

A point's position in the file's frame is

```
world = origin + R · local
```

`local` is what the hierarchy and the payloads hold (cube corners, bounds,
cluster minima, decoded points — all relative to the header origin, along the
stored axes) and `R` is the metadata `rotation` (a unit quaternion; absent =
identity, the usual case). The header bounds and every node box are therefore
axis-aligned in the *stored* axes; a reader that culls or snaps works there
(moving the eye and the frustum in with `Rᵀ`) and turns results out with `R`.
Setup poses and panorama rotations are given in the file's frame directly.

The cook keeps the source's grid — rotating it would mean re-quantizing every
point — and uses `R` for a source whose coordinate system is rotated against
its grid:

* **LGSX**: the file's frame is the project's coordinate system — the *active* one, else the one made from survey control (the
  user coordinate system the Leica software shows and exports in — an E57
  exported from the same project has these coordinates). With its pose
  `C` (coordinate system → project frame): `R` = rotation of `C⁻¹`,
  `origin` = `C⁻¹(grid origin)`, setup poses = `C⁻¹ ∘ setup pose`. Without an
  active one the frame is the project frame and there is no `rotation`.
* **E57**: the file's world (scan poses applied); no `rotation`.

## Metadata (UTF-8 JSON)

```jsonc
{
  "format": "tdpp", "version": 1,
  "generator": "scan-cook 0.1.0 (meshoptimizer 1.3)",
  "source": { "format": "lgsx" | "e57", … },
  "frame": "LGSX coordinate system \"…\"" | "LGSX project frame …" | "E57 world (scan poses applied)",
  "rotation": [w,x,y,z],     // optional: stored axes → the file's frame (see "Frame")
  "coordinate_systems": [ { "name": "…", "active": true, "control": false, "used": true, "pose": { … } } ],
                             // LGSX: all of the project's; "used" = the one this file is in
                             // (none = the project frame); pose = system → project frame
  "grid_scale": 0.001,
  "lod": "additive",
  "cluster_size": 256,
  "streams": { … },
  "cube_faces": [ { "name": "+Y", "view": [0,1,0], "rotation": [w,x,y,z] }, … ],
  "setups": [
    {
      "index": 0,            // per-point setup value, or null when points carry none
      "name": "…", "label": "…", "guid": "…",
      "pose": { "rotation": [w,x,y,z], "translation": [x,y,z] },   // setup → source frame (absolute, not origin-relative)
      "panorama": {
        "kind": "cube",
        "faces": [
          { "face": 0, "view": "+Y", "rotation": [w,x,y,z],
            "levels": [ { "width": 3072, "height": 3072, "format": "jpg", "offset": …, "size": … }, … ] },
          …
        ]
      }
    }
  ]
}
```

**Panoramas**, `kind: "cube"`: six 90° pinhole faces per setup. A face camera looks down its
local −Z with +X right and +Y up in the image; its pose in the source frame is
`setup.pose ∘ face.rotation`. `levels` is the mip chain, largest first (LGSX
supplies 3072² → 1²; E57 has the full resolution only). The enter-scan view
places the camera at `setup.pose.translation` and draws the cube around it.

`kind: "sphere"` (E57 `sphericalRepresentation`, what most non-Leica
scanners export) is one equirectangular image:

```jsonc
"panorama": {
  "kind": "sphere",
  "rotation": [w,x,y,z],          // image frame → source frame (absolute)
  "pixel_width": 0.000767, "pixel_height": 0.000767,   // radians per pixel
  "levels": [ { "width": 8192, "height": 4096, "format": "jpg", "offset": …, "size": … } ]
}
```

A direction `d` in the image frame (Z up) has azimuth `atan2(d.y, d.x)` and
elevation `asin(d.z)`; it lands on column `width/2 − azimuth/pixel_width`,
row `height/2 − elevation/pixel_height` (the E57 convention: the image centre
looks along +X, azimuth grows to the left). The image is stored whole at its
source resolution — the viewer downscales it to what its GPU takes.

## Cooking

* **LGSX**: the HSPC octree already has additive LOD (root 262 m, leaves
  0.5 m, up to ~300 k points per node). Nodes are decoded and re-encoded
  1:1, about 25 s for 461 M points on 4 cores.
* **E57**: out-of-core octree build without temp files. The records are
  taken in blocks of 2²⁰. Pass 1 computes bounds; pass 2 counts points on a
  128³ grid to choose chunks (≤ 8 M points) and notes which coarse cells
  each block touches; then one pass per batch of chunks (≤ 48 M points in
  memory) builds subtrees, decoding only the blocks that touch the batch —
  on the Piazza sample that is 2.5 passes' worth of decoding where reading
  everything took 11. Nodes split above 65,536 points, and each parent takes
  ≈ ¼ of its children's points, capped at the capacity, chosen by
  `meshopt_simplifyPoints` (position + colour aware). The tree above the
  chunks is built last. Every stage has a byte form, so the browser runs
  them on sub-workers (`scan-wasm` `E57Cook` / `E57Part`): the packet
  headers are walked once and shared, workers build whole batches, and the
  coordinator writes them in order — the file is the same whatever the
  worker count.
* `scan verify out.tdpp source` checks the result: LGSX node by node
  exactly; E57 by point count + an order-independent hash of every point's
  (grid position, RGB, intensity, setup).

## Results on the Piazza sample (461,771,540 points, 14 setups, 4 cores)

| source | cook time | nodes / depth | file size | points B/pt | verify |
|---|---|---|---|---|---|
| LGSX | 25 s | 3,855 / 10 levels (≤ 302 k pts/node) | 2.91 GB (incl. 175 MB of 3072² → 1² JPEG mip chains) | ≈ 5.9 | every node identical to the LGSX node |
| LGSX `--normals` | 36 s | same | 3.66 GB | ≈ 7.5 | identical, normals included |
| E57 | 71 s (2 passes + 2.5 passes' worth of blocks, parallel decode at ~48 Mpts/s) | 23,370 / 11 levels (≤ 65,536 pts/node) | 2.56 GB (incl. 42 MB of full-res faces) | ≈ 5.5 | same count + identical multiset hash, 0 coarse clusters |

Both cooks are byte-deterministic (chunk points are sorted before the LOD
build and parallel results are committed in input order), so cooked files
can be pinned by hash. Bytes per point drop with depth (≈ 9.5 at the sparse root, ≈ 5 in dense
leaves). The TS reader (`src/lib/tdpp/tdppFormat.ts`, npm meshoptimizer 1.2.0) decodes nodes
bit-identically to the Rust reader. A coarse LOD (depth ≤ 5, ~21 M points)
rendered through a setup's face camera lines up with that setup's embedded
panorama.
