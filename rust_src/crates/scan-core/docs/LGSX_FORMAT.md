# LGSX format — what we know

Leica's "Leica Project File X" (`.lgsx`), written by Cyclone REGISTER 360
PLUS / FIELD 360 and read by TruView / JetStream / Cyclone ENTERPRISE. No
public specification exists; everything here was reverse-engineered from the
samples and checked against the E57 export of the same projects.

Status labels: **VALIDATED** = checked against independent ground truth;
**DECODED** = parsed consistently across every instance in the samples, no
external check; **INFERRED** = consistent but with an untested assumption;
**OPAQUE** = located but not decoded.

Reference sample: `Piazza della Repubblica.lgsx` (3,528,306,703 bytes,
writer `2026.2.0.dev.r349`, 14 setups, 461,771,540 points) plus its E57
export `Piazza-della-Repubblica.e57` (E57Format-3.3.0). All integers are
little-endian unless stated.

## 1. Outer container — DECODED

```text
file := ( "wild::geosystems" banner-record  payload )*  index  trailer
```

* Each section payload is preceded by the 16-byte banner `wild::geosystems`
  and a copy of its index record. The first section (`PointCloud`) starts at
  file offset 0xAF.
* **Index** (`HXMETAV1` + records), near EOF. A record:

  | field | type | notes |
  |---|---|---|
  | rec_len | u16 | bytes after this field (may include 2 bytes of padding) |
  | parent | i32 | −1 for every top-level section seen |
  | id | u32 | 1-based |
  | name_len | u16 | includes the NUL |
  | name | bytes | NUL-terminated |
  | kind | u8 | 3 = data, 2 = property tree, 1 = image |
  | offset | u64 | absolute payload offset |
  | size | u64 | payload size |
  | hash_len | u16 | 0x81 |
  | hash | bytes | 128 hex chars + NUL (SHA-512-sized, algorithm not checked) |

* **Trailer** (last 32 bytes): `"Leica Project File X"`, u32 (205 in the
  sample), **u64 table_offset**. At table_offset: `u32 count`, `count × u64`
  absolute offsets of the index records, then `u16 len + hash`,
  `u16 len + writer version` (`2026.2.0.dev.r349`), more hashes, the project
  GUID (`u16 36 + text`), and the trailer.

### Sections in the sample

| name | kind | content |
|---|---|---|
| `PointCloud` | 3 | myVR mMapArchive with the HSPC octree (§2–4), 2.58 GB |
| `ASSET-1…5` | 3 | JPEG XR images (640×640) — OPAQUE purpose (attachments/thumbnails) |
| `SETUP-camera-N` | 3 | colour cube map, JPEG (§5) |
| `SETUP-scanintensity-N` | 3 | intensity cube map, greyscale JPEG (§5) |
| `SETUP-scandepth-N` | 3 | range cube map, JPEG XR (§5) — pixel encoding OPAQUE |
| `SETUP-depthmask-N` | 3 | valid-range mask cube map, PNG (§5) |
| `SETUP-TruViewMaskKey0…5-N` | 3 | 1024² PNG per face — OPAQUE (TruView masks) |
| `SETUP-TruViewDatKey0…5-N` | 3 | `LCCF` blobs per face — OPAQUE (TruView cube-face format) |
| `SetupThumbnailArchive` | 3 | nested record archive of JPEG XR thumbnails per setup GUID — OPAQUE |
| `ProjectDatabase` | 3 | SQLite 3 database (§6) |
| `ProjectInfoDatabase` | 3 | SQLite 3 database (project metadata) |
| (unnamed, id 234) | 2 | property tree: `ProjectInfo`, `AppNameVersion` = "Cyclone REGISTER 360 PLUS 2026.2.0", `AssetCount`, `BundleCount` … |
| `ProjectThumbnail` | 1 | JPEG XR |

`N` in `SETUP-*-N` is `Hds_OdbSetup.mId`.

## 2. mMapArchive (`PointCloud` section) — DECODED

myVR (Hexagon) archive; file 0 is a banner "This archive was created by
myVR::mMapArchive … Build number: 82138".

```text
0x00 "mMPK"  u32 version=1  u32 0  u32 file_count
0x10 u32 trie_len  u32 pool_len  u32 dir_block_len  u32 size_block_len
0x20 u64 data_offset (0x1000038: 16 MiB reserved)  16 × 0
0x38 dir block  : u32 raw_len | zlib(trie[trie_len] | pool[pool_len])
     size block : u32 raw_len | zlib(u32 size × file_count)
data_offset     : files back to back, in file-index order
```

**Directory trie.** A node is `varint label_off | u8 label_len | u8 count`.
A leaf (`count == 0`) is followed by `varint file_index`. An inner node is
followed by `u8 0`, the first child's edge byte, then
`(varint rel_off, edge byte)` for each further child; child offsets are
relative to the end of the node (where the first child begins). The label is
`pool[label_off .. label_off+label_len]` (NUL included in the length). A
path is the concatenation of labels and edge bytes from the root; varints are
big-endian base-128. All 3,859 files resolve to unique paths:

```text
/buildVersion.txt  /hspcInfo.json  /queryTree.hspc  /tree.hspc
/<L>/<bucket>/L<L>X<hex>Y<hex>Z<hex>.apr     (3,855 octree nodes)
```

## 3. HSPC octree ("Hexagon Smart Point Cloud") — VALIDATED

`hspcInfo.json` → `tree-header-info`: attributes (`POSITION` M96, `R`/`G`/`B`
U8, `INTENSITY` U16, `Normal` U16, `SetupIndexU8` U8), `bounding-box`,
`origin`, `scale` (0.001), `root-offset` (2³¹ ×3), `min-lod` 9, `max-lod`
18, `node-size` 262,144, `point-count`, and metadata (`SetupLUT`:
SetupIndexU8 value → setup name, `HasColor`, `Recolored`, codec specs).

* **Grid**: world (project frame) = `origin + (ix − 2³¹) · scale` per axis.
  The 2³¹ is a constant. `root-offset` is NOT the grid zero: it is the root
  node's key (2³¹ in Piazza, 2³¹ + 3·2¹⁵ in Teatro Pergolesi, 2³¹ + 2¹⁶ in
  the BLK360 office sample). Subtracting it instead shifts the whole cloud
  away from the setups and their photos.
  The E57 coordinates of the same project are exactly these values rounded to
  f32.
* **Nodes**: `L<L>X<x>Y<y>Z<z>.apr` covers the cube `[key, key + 2^L)` in
  grid units; the root has `L = max-lod` (18 → 262 m), leaves `min-lod`
  (9 → 0.512 m).
* **No duplication**: Σ node point counts = `point-count` exactly. Coarse
  nodes hold a subsample of their region (filled to `node-size`), finer nodes
  the rest — Potree-style LOD; loading a subtree top-down refines
  progressively.
* `queryTree.hspc`, `tree.hspc`: `APRT` headers + zstd-compressed JSON
  (`CJSO`) — the hierarchy; OPAQUE (not needed: node keys are in the names).

## 4. `.apr` node files (`APRN`, format 22) — VALIDATED

```text
0x00 "APRN"        0x04 u64 file_size       0x0C u32 format_version (22)
0x10 u32 attribute_id (= hspcInfo attribute-id)
0x14 u64 point_count  0x1C u64 payload_size
0x24 u64 key[3]    0x3C f64 scale[3]   0x54 f64 origin[3]
0x6C u32 level     0x70 u64 header_size (payload offset; 266 here)
0x78 u64 bbox[6]   node-local min/max — LOOSE: real points exceed it
0xA8 u32 attr_count, per attribute:
     u8 dtype | u8 role | u32 0 | u16 name_len | name
     dtype 0 = U8, 1 = U16, 2 = U32, 10 = M96;  role 0 = POSITION, 4/5/6 = R/G/B,
     8 = INTENSITY, 100 = CUSTOM
payload: u8 0x64 | u8 group_count | u64 group_offset × group_count
         then per byte plane: u64 len | zstd frame
```

* Every zstd frame inflates to exactly `point_count` bytes: values are
  stored as **byte planes**. Groups: non-colour attributes in table order
  (POSITION 12 planes, INTENSITY 2, Normal 2, SetupIndexU8 1), then R/G/B as
  one 3-plane colour group.
* **Pair-swapped storage**: plane byte `i` belongs to point `i ^ 1`
  (an odd last point stays in place).
* **POSITION**: in point order, 96-bit integer deltas (planes = bytes 0..11)
  of the points' **sorted 3-D Morton codes**: code bit `3i` = x bit `i`,
  `3i+1` = y, `3i+2` = z (32-bit grid coordinates). Prefix-sum, then
  de-interleave.
* **INTENSITY**: u16 deltas; `value / 65535` equals the E57 intensity.
* **SetupIndexU8**: u8 deltas; index into `SetupLUT`.
* **Colour**: plane 0 = G as u8 deltas; plane 1 = B − G, plane 2 = R − G
  (mod 256, per point, not delta coded).
* **Normal**: u16 deltas of a 16-bit code (`CodecNormal16PcApi`) —
  DECODED (fitted): latitude rings of constant polar spacing,
  ring `k = 0..=226` at `θ = k·π/226` from +Z with `max(1, ⌈452·sin θ⌉)`
  codes (65,144 in all), code = ring start + `j`,
  `φ = −π + (j + ½)·2π/size`; normals point towards the scanner; 65535 =
  none. Fitted against PCA normals of 3.8 M points oriented towards each
  point's setup position: median deviation 0.8° (up), 2.6° (facades),
  2.3° (ceilings) — the PCA noise level — and signed azimuth bias below a
  quarter ring step; every alternative tried (Fibonacci sphere, octahedral
  8:8, spherical 8:8) is off by ~45° on facades.

Validation (`crates/scan-core/examples/lgsx_vs_e57.rs`): 40 nodes of every level
(4,384,490 points) decoded and matched against the E57 snapped to the grid —
**100 %** of positions, intensities and RGB identical. Full-file check
(`examples/lgsx_full.rs`): all 461,771,540 points decode, none outside its node cube,
all setup indices within the LUT. Visual check: points rendered through a
setup's cube-face camera reproduce the panorama photo.

## 5. Cube-map sections (`CUBE`) — DECODED, orientation VALIDATED

```text
"CUBE" | face 0 … face 5 | property blocks | u64 table[8] (last 64 bytes)
table = [4, face1 … face5 offsets, faces_end, meta_offset]
```

Each face is a full mip chain of concatenated images, largest first
(camera: 12 JPEGs, 3072² → 3² → 1²). The property blocks (`ExposureTime`,
`ImageType`, `Type Info` "u8:3", `Width`, then `HXMETAV1` with
`CubemapOffset`, `LayerEnum`, `PixelType`) are not needed to extract faces.

**Face order** (setup frame, Z up; each face a 90° pinhole camera looking
down its local −Z, +X right, +Y up — the E57 pinhole convention):

| face | view | camera→setup rotation (w, x, y, z) |
|---|---|---|
| 0 | +Y | (√½, √½, 0, 0) |
| 1 | −Y | (0, 0, √½, √½) |
| 2 | −X | (½, ½, ½, ½) |
| 3 | +X | (½, ½, −½, −½) |
| 4 | +Z (up) | (0, 1, 0, 0) |
| 5 | −Z (down) | (1, 0, 0, 0) |

Each LGSX face is pixel-identical in content (correlation 1.000, no flip) to
one of the six E57 pinhole images of that setup. The E57 pinhole focal length
(9.21300 mm, 6 µm pixels, 3072 px) gives a 90.02° field of view: treat faces
as 90°.

## 6. Setups (`ProjectDatabase`, SQLite) — VALIDATED

Table `Hds_OdbSetup` (one row per setup; skip `mIsDeleted = 1`):
`mId` (section suffix), `mName` (matches `SetupLUT`), `mLabel`, `mGuid`,
`mResourceId` (GUID used in resource names and in the E57 image names),
`mRotation0..3` = quaternion **x, y, z, w**, `mPosition0..2`.

The pose maps **setup frame → project frame**. Checked on all 14 setups ×
6 faces: the E57 image poses equal `data3D_pose ∘ setup_pose ∘ face_rotation`
to 4·10⁻¹⁶ (rotation) and 1·10⁻¹⁴ m (translation); the inverse convention
is off by 9·10⁻⁵. (The E57 export's world origin is setup `_6`.)

### Coordinate systems (`Hds_OdbCoordSystem`) — VALIDATED

One row per user coordinate system ("UCS 1", "Pre-Registered" …): `mId`,
`mName`, `mRotation0..3` = quaternion **x, y, z, w**, `mPosition0..2`,
`mWKT` (empty in every sample). `Hds_OdbWorkspace.mActiveCoordSystem` names
the active one (`mId`; 0 = none).

The pose maps **coordinate system → project frame**, so a project-frame
point `p` has the coordinates `pose⁻¹(p) = Rᵀ(p − t)` — and those are the
coordinates the Leica software exports. Checked on Piazza della Repubblica:
setup `_11` at project (−17.7835, −12.5825, 0.0009) with the active system
at (20.0981, −22.4219, 0.0189) gives (−37.8816, 9.8394, −0.019), the pose
translation of that setup's images in the E57 export of the same project
(−37.88158, 9.83938, −0.01927). In Teatro Pergolesi the active system sits
exactly on one setup's position. A file can also hold systems that are not
active (rotterdam: "UCS 1", turned 82° about Z, `mActiveCoordSystem` 0).

What Leica documents (Cyclone REGISTER 360 PLUS, "Coordinate Export
Behaviour" and "Automatic UCS Creation When Applying Control"): the active
UCS determines what is exported; applying survey control creates a UCS
named after the control and linked to it (`mIsControl` = 1 on its row);
and **until 2024.0.2 the Control coordinate system took priority over an
active UCS** when both were present, while from 2025.0.0 the active UCS is
respected. The reader always takes the active one, so a file written by
2024.0.2 or older that has both may differ. "Pre-Registered" is the system
created when a pre-registered E57 is imported.

Two public Leica samples were checked for this: *Fort Myers Mural Wall.lgsx*
(CloudWorx practice data; `WCS`, `mIsControl` = 1, active, identity pose,
setups within ±125 m — the control system is the project frame itself) and
*CloneLGSx.lgsx* (Cyclone 3DR tutorial; no coordinate system). Neither has
a control system with a non-trivial pose or an offset.

**Which system is used**: the workspace's active one; without one, the
system flagged `mIsControl` (survey control applied but not made active —
seen in a real 2025.0.1 project: "Control", about 20 km and 3.7° from the
project frame); else the project frame. In that project the control
system agrees with the separate `Hds_OdbAppliedControl` row
(`mpSetup`, `mPosition*`, `mRotation*` = **control coordinates → that
setup's frame**): inverting it puts the setup at the control coordinates
that the coordinate system gives for a point 18 m from the project origin
at height 0 — a setup position. The cooked file lists every system
(`coordinate_systems`, `used` = the one it is written in) so a viewer can
switch.

**Not applied, not validated** — everything below is zero, identity or empty
in all six samples, so a project tied to survey control (real-world
coordinates) may use it and come out in the wrong place:

* `Hds_OdbControlCoordSystem`: the systems again, with a setup reference
  (`mpSetup`), a pose in another convention (Piazza: the negated E57
  position of that setup), **`mOffsetX/Y/Z`** (always 0 — likely the large
  easting / northing offset of a georeferenced system) and `mWKT` (empty).
* `Hds_OdbTerrestrial.mControlPosition*` / `mControlQuaternion*`: a
  "control" pose, always identity.
* `Hds_OdbSurveyControl`, `Hds_OdbAppliedControl`, `Hds_OdbControlPoint`:
  survey control, always empty. The ProjectInfo section counts
  `CoordSystemFromControlCount` separately from `CoordSystemCount`.
* `Hds_OdbSitemap.mpActiveCoordSystem`: equals the workspace's in the
  samples that have one.
* Coordinate systems that are not the active one (rotterdam "UCS 1").
* No unit is stored anywhere seen; coordinates are taken as metres.

The reader collects these rows as text (`Lgsx::coord_report`, shown by
`scan info` and, in the app, in the Console at import) so a file that
cannot be shared can still be diagnosed.

Other tables seen: `Hds_OdbScan`, `Hds_OdbLink` (registration links +
`Hds_OdbErrorStats`), `Hds_OdbPointCloud`,
`Hds_OdbProjectProperty`, `Hds_OdbWayPoint`, `Hds_OdbSitemap`.
`mMetadata` blobs use the same property-tree encoding as section 234 —
OPAQUE.

## Open problems

* JPEG XR depth cube pixel format (range units) and `LCCF` TruView blobs.
* Property-tree encoding (`u16 name_len | name | u16 value_len | u8 type …`).
* Files without the EOF trailer (body walk via the `wild::geosystems`
  banners) — no such sample.
* A second sample (`TeatroPergolesi.lgsx`) has not been run yet.
