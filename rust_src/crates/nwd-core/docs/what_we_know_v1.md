# What We Know — Navisworks NWD format

Reverse-engineered, byte-level knowledge of Autodesk Navisworks NWD/NWC files. Every claim is
labeled:

- **DECODED** — read byte-for-byte by cited parser code; byte-exact or corpus-verified.
- **VALIDATED** — passes an external check (Navisworks' own FBX export, the source attribute
  files, cross-file agreement, user click-tests in Navisworks).
- **INFERRED** — reconstructed by heuristics at runtime, not read from the file.
- **GUESS** — a hypothesis consistent with observations; alternatives not eliminated.
- **OPAQUE** — bytes present, meaning unknown.

There is **no public spec** and no public parser for this format (the internal operator names
such as `LcOpNwdGeometryCompress` have no public hits; ODA BimNv implements the format but is
closed). Everything here is empirical.

**Evidence.** The public reference corpus is the Equinor **Huldra** open-data dataset
(~600 MB zipped, not committed; the three NWDs the tests use are in
`convertSamples/nwd/huldra/`, whose README says where to get the rest): AVEVA RVM
exports + their CADC attribute `.txt` files (the SOURCE), the NWDs Navisworks built from them
(22 per-area files of ~10 RVMs each, the same 22 "with insulation and obstruction", and one
assembly NWD of all 22 areas), and FBX files exported from the NWDs by Navisworks. Writer:
Navisworks 2021-era, `lichunk-008`, RVM loader. Earlier work also used private models (other
RVM-loader exports, DWG/3DS-loader files, ~2013 `lichunk-007` files); those are not in this
repository and are only referred to generically below.

## Live metrics (Huldra, current build)

**The FBX export is a per-leaf ground truth** (VALIDATED as such): one `Mesh` model per
geometry leaf holding all of that leaf's fragments, one `Null` per container, the NWD tree
names, world-space vertices in NWD native axes (Z up, metres), identity transforms.
The validation scripts named in the table (`fbx_check.py` / `fbx_corpus.py`,
`props_check.py`) belong to the repository this converter was developed in and are not part
of this one; they match every leaf by name path and compare bbox + nearest-vertex distance
(tolerance 2 mm).

| check | result |
|---|---|
| `fbx_corpus.py nwd/ fbx/` — 22 area NWDs | **183,219 / 183,219 leaves** within 2 mm; tree 0 missing / 0 extra nodes; 19.88M tris vs FBX 19.93M (gap = deduplicated double-sided faces) |
| `fbx_corpus.py` — 22 insulation/obstruction NWDs vs their FBX | **84,402 / 84,402 leaves** within 2 mm; tree 0 missing / 0 extra |
| `fbx_corpus.py nwd_assembly/ fbx/` — the assembly NWD | 234,760 nodes; **183,219 / 183,219 leaves** within 2 mm of the 69 FBX files; all 426,528 fragments linked; triangle total identical to the per-area runs |
| `props_check.py` — 44 NWDs vs the RVM `.txt` | **44/44 files exact**: every property block maps to a node and equals its `.txt` element, every key and value |
| mesh records decoded (`rec_survey` example) | 100% on every file |
| conversion time / peak memory, assembly NWD (35 MB → 22 GLBs, 431 MB; 4 cores) | **2.3 s / 550 MB** (was 8.0 s / 891 MB); output byte-identical to the previous build |
| `cargo test --workspace` | all pass (2 stale `faithful_*` tests of the fallback-only heuristics are `#[ignore]`d) |

Read metrics only from this table. The script rows were measured on the full dataset and
cannot be refreshed from this repository; the `cargo test` suites pin the same expectations
on the three committed NWDs.

## Container — DECODED

- `#LcUStream-V1.1 binary double release C lichunk-008` ASCII signature + a 44-byte header blob
  (a format constant — identical across files; not a per-file GUID/checksum), then zlib chunks,
  then a nested `navisworks:451` sub-stream holding an **operator registry** (entries of
  `{name, count, first_offset, compressed_size, flags}` that exactly tile the file), then a
  footer signature. Parser: `container.rs`, `inspect.rs`.
- RVM-loader writers put the zlib chunks back to back (boundaries from zlib `total_in`; no table
  of contents). Other writers interleave metadata between chunks: the walk scans forward for the
  next valid zlib header and validates by inflating (false positive ⇒ skip 1 byte), stopping at
  the footer signature. All writers seen so far parse.
- Inflated chunks cap at 65,536 B, so chunk NUMBERING shifts with the geometry size: locate
  chunks by role (below), never by index.
- **The container index is LAZY**: `Container` holds `(offset, compressed_len, inflated_len)`
  per chunk and inflates on demand (`Container::data(i)`) — real models inflate to ~5× the file
  size.
- **Version stability — VALIDATED**: the same model saved by Navisworks 2016-era, 2025 and 2026
  differs only in metadata (saved path, the XRefTable JSON, one save GUID, low-order f64 jitter
  in fragment records). Chunk roles, grammar and codecs are unchanged 2016→2026.
- OPAQUE: the registry `flags` u64 values; a 10-byte post-registry gap.

## Chunk roles (DECODED; order as written by the RVM loader)

| role | content |
|---|---|
| **Geometry records** | the byte bulk; one or more chunks (see Geometry) |
| **Geometry size index** | `[count][nchunks][nchunks × compressed chunk sizes][count × record sizes][0 pad]` — present in every file, immediately after the geometry chain; the authoritative geometry locator (`inspect::geometry_chunks_by_index`). Its compressed sizes match zlib-consumed bytes (back-to-back writers) or on-disk spans (writers with interleaved metadata) |
| zero markers | 8-byte zero chunks delimiting sections |
| `LcOaPartition` metadata | the NWD's own File node: `[100][32][0][name]`, class `File`, F = 3 (a type-92 record with the model GUID/ids, a material, an inline `PDMS File Comments` property set), then the usual File trailer (lights, loader plugin, source path). Type-92 framing OPAQUE. No unit FACTOR or up-vector anywhere; the trailer's plugin slot names the loader, which is what the converter's unit scale goes by (see *Units*) |
| **Property stream** | n chunks (see Property stream) — new in writers that store attributes |
| **LogicalHierarchy** | the selection tree (see Hierarchy) |
| **Fragments** | placements (see Fragments) |
| **Spatial BVH** (`chunk8.rs`) | `(tag,count)` grammar: partitions → leaf-groups → a permutation of all fragment indices. Spatial only — NOT a fragment→leaf link. Test-locked on Huldra (2 partitions, 80 groups, 852 ids) |
| GuidStore | 16-byte model GUID (reappears in the source-ref chunks); value OPAQUE |
| import log | ASCII loader log (RVM: group/primitive/facet/line counts) |
| source refs | source path + content hash of the source file |
| saved viewpoint | u32 847, u32 0, eye 3×f64 @+8, unit quaternion 4×f64 @+32, FOV π/4, near/far-like f64s |
| constants | `[0.3, 1.0]`, an identity/unit block, a background/light colour palette |
| lights JSON | identical across files except embedded GUIDs |
| XRefTable JSON | fully DECODED |

Coordinate map used by the converter: NWD native `(c0,c1,c2)` → glTF Y-up `(c0, c2, −c1)`.
Native axes are Z up, metres (the Huldra FBX export uses the same frame).

## Geometry records — FULLY DECODED (positions + connectivity + normals)

**Record header** `u32 [100][variant][101][60][h4][h5]`:
- `variant` 94 = surface mesh, 95 = line set, 96 = point set; 104 / 105 = AUX parametric
  primitive (below).
- `h5` = position float count; nv = h5/3; positions = nv × 3×f32 at header+24 (full f32).
- `h4` = INDEX COUNT of the stored polygon set (can be odd).
- `[101][60]`: constant on every v94/v95 record (a magic; meaning OPAQUE). AUX records instead
  carry a flag word (0 / 3 / 0x30003) and 0.
- **Record bounds**: the size index gives every record's exact size; the converter walks the
  records with it (`geometry::parse_sized`) so a mesh record's codec tail never runs into AUX
  records interleaved after it (Huldra interleaves ~37k AUX records with its meshes).
- **v95 line sets — DECODED 2026-11-12** (`geometry::decode_polylines`): indexed polylines
  built from the same pieces as a mesh record. After the vertex block: a PRE stream in the
  mesh LZ codec → index array (length h4; empty = identity), then zero words (DWG/3DS-type
  files) or the mesh marker `[102][100][-h4]` + a normal stream (RVM loader), then the
  `[n][w][n]` triple and a bit table of n VERTEX COUNTS per polyline; a polyline of k indices
  is k−1 segments (closed loops repeat their first index via `f0 00 00`). The old reading
  "consecutive vertex pairs" only held for unindexed 2-vertex lines and dropped every other
  segment of longer polylines. 100% of the line records in the private DWG/3DS/RVM test
  files decode (indices in range, counts summing to h4); no openly licensed file with line
  records is available yet, so this is locked by a synthetic unit test only. Rendered as
  thin X-crosses.
- **v96 point sets**: header as v94/v95, nv points, no connectivity (tail all zero). Not
  rendered (previously mis-rendered as the hull of the points).

### Connectivity codec (`LcOpNwdGeometryCompress`) — DECODED

Byte-exact encode/decode round-trip on every unique stream tested; 100% of Huldra mesh records
decode. Implementation: `geometry.rs` (`lz_decode`, `decode_connectivity`). A small
**LZ-style back-reference codec emitting the flat vertex-index array** (length h4), NOT
Edgebreaker/CLERS. Layout after the position block:

```
PRE stream                    → index array V (length h4)
[u32 [102][61][-h4] + UVs]    OPTIONAL texture-coordinate block (below)
u32 [id][100][-h4]            normals block; id = 102, or 103 after a UV block
u32 count + normal stream     quantised normals (below)
u32 n, u32 w, u32 n           polygon-count triple
bit table                     n unsigned w-bit POLYGON CORNER COUNTS,
                              packed MSB-first within little-endian u32 words
corner stream                 only if sum(counts) > h4: u32 total, then the same
                              LZ codec emitting `total` corner ids
0x00 padding
```

PRE/corner stream tokens (write position p = current output length):
- raw byte `r` (0x00–0x3f): append r+1 NEW sequential ids (runs >64 split greedily, `3f 07`)
- `0x40+v` (v=0..63): append `out[p−v]`
- `0x80+k` (k=0..0x3f): append `out[p−1]` k+1 times (RLE — same token as in the normal
  stream; k>0 is common in Huldra fan-like loops that revisit one vertex)
- `0xeN XX`: v = N×256+XX back-ref (e0/e1 common; e2+ seen in DWG-sourced files)
- `f0 00 00`: append `out[0]`

Encoder rule (byte-exact): v = p − (most recent position holding the wanted id).
`NWD_TRACE_FAIL=1` prints the failing stage and PRE bytes of any record that does not decode.

Triangulation: split the corner-id array by the counts into polygon loops; vertex of corner
c = V[c]; each loop is in **GL_TRIANGLE_STRIP order** — tris `(s1,s0,s2),(s1,s2,s3),(s3,s2,s4)…`.
Empty PRE = implicit identity. Multi-component records are plain concatenations. Double-sided
records store the polygon set twice (the renderer dedups exact duplicate triangles — the FBX
export keeps them, hence its slightly higher triangle count).

### Per-corner attribute blocks

After the index stream a mesh record carries one block per corner attribute, each headed
`[id][type][-h4]`. The ids continue the record's own interned sequence (100 = the record,
101 = positions `[101][60]`, then 102, 103 …), so the SECOND block of a record has id 103:

| type | content | header seen |
|---|---|---|
| 100 | quantised normals (next section) | `[102][100][-h4]`, or `[103][100][-h4]` after a UV block |
| 61 | texture coordinates | `[102][61][-h4]` |

RVM- and Revit-loader records carry normals only. Records of DWG/3DS-sourced files with
mapped materials carry **UVs first, then normals**. A decoder that looks only for
`[102][100]` finds no marker in those and fails the whole record (this was the cause of
every undecoded mesh record in such files — up to 70% of a file — which then rendered
through the inferred hull/strip fallback).

UV block body (layout VALIDATED by decoding it end to end — the token stream emits exactly
h4 entries, consumes exactly `count` fresh ones and ends at the normals header — on 99.4% of
the instances seen; the UV *values* are not exported and were not checked against a source):

```
4 × f32      u_min, v_min, u_max, v_max      (all 0 when the record has one constant UV)
u8 u_bits, u8 v_bits, u16 0                  quantisation widths (0/0, 1/1, 8/1, 1/8, 8/8 seen)
u32 count                                    distinct UV pairs
bit table    count × (u_bits + v_bits) bits, padded to a u32
token stream h4 outputs, same tokens as the index stream (raw = fresh entries)
```

### Normal stream — DECODED

Between marker+12 and the polygon-count triple:
- `u32 count` — distinct quantized normals in this record's table.
- Table: `count` × 3 bytes, each an i8 = floor(n·128) (renormalize on decode), packed
  **MSB-first inside little-endian u32 words**, padded to 4 bytes.
- Index stream emitting one normal per corner slot (h4 outputs): raw `r` = r+1 FRESH table
  entries; `0x40+v` = copy `out[p−v]`; `0x80+k` = repeat previous k+1 times; `0xd0+k` = fixed
  axis codebook (d0=+X, d1=−X, d2=+Y, d3=−Y, d4=+Z, d5=−Z); `0xeN XX` long back-refs;
  `f0 00 00` = copy `out[0]`. When `count == h4` the table IS the per-corner array.
Mean 0.40° vs geometric face normals on flat polygons. The stored normals are the authoritative
OUTWARD direction — the converter sets each decoded triangle's winding from them. Unobserved:
opcodes 0xc0–0xcf. Degenerate all-zero table entries occur and must be tolerated.

### AUX records (variant 104/105) — DECODED, VALIDATED

**Parametric oriented primitives**, in the fragment's LOCAL frame (`geometry::aux_primitives`):
- v104 (56 B) = `[u(3×f32 unit), v(3×f32 unit), radius, 0.0]` — a flat disc at the local
  origin, normal u×v (outward).
- v105 (64 B) = `[origin(3×f32), u, v, radius]` — an OPEN cylinder from the local origin to
  `origin` (∥ u×v); its caps are separate disc fragments of the same leaf.
- The VARIANT word decides the kind; word2 is a flag word (six Huldra v105 records have
  word2 = 0 — keying on word2 misread them as discs).
- **Navisworks tessellation (VALIDATED vertex-exact against its FBX export)**: 32 segments,
  first ring vertex at angle 0 along `u`, increasing toward `v`; disc = fan around its centre,
  cylinder = 64-triangle open tube. `geometry::aux_points` / `aux_disc_indices` /
  `aux_tube_indices` reproduce it. Degenerate records (r = 0 or zero frame) render nothing,
  as in Navisworks.

### Old record format (`lichunk-007`, ~2013 Simulate) — DECODED

5×u32 header `[100][94][101][60][h4]` (no h5); h4 × vec3 f32 UNCOMPRESSED corner positions;
u32 0; marker `[102][100][+h4]` (positive); h4 × 3×i16 normals (n/32767); align4 + u32 0;
`[u32 nfaces][nfaces × u16 corner counts]` (strip order). 100% of records of two test files,
mean normal error 0.09°. The placement layer of this format is NOT decoded (instanced models
overlap at the origin).

### NWD vs RVM tessellation

The NWD stores its own compact tessellation; RVM-side tools facet the same elements more
finely. The converter's target is the NWD record set (which is what Navisworks renders and
exports).

## Fragments — DECODED (RVM loader)

One 120-byte record per placement, spanning `o−40 .. o+80` relative to its `[93]` marker at `o`:

| offset | field | status |
|---|---|---|
| o−40 | f64 per-shape scalar (1.0 default); `f32@o+56` is a 32-bit copy | position DECODED, meaning OPAQUE |
| o−32, o−28 | w0, w1 — per-record constants (w1 = 8 for line sets, else 4) | OPAQUE |
| o−24 | **class flag** (table below) | DECODED |
| o−20 | **group id** = the leaf's 1-based DFS ordinal (see Linking) | DECODED + VALIDATED |
| o−16, o−12 | constants 0, 1 | — |
| o−8 | idA — partition id | DECODED |
| o−4 | idB — sequential per-fragment id (+2 steps, shares the partition id space) | DECODED |
| o+4..28 | local AABB, 6×f32 | DECODED |
| align8(o+28) | world translation, 3×f64 | DECODED |
| t+28 | rotation-invariant canonical-shape hash (a cross-file shape key, not a pointer) | VALIDATED |
| t+32 | **geometry-record index**, 1-based into the full on-disk record array (mesh + AUX) | DECODED + VALIDATED |
| t+36 | idB+1 (0 on the last record = end sentinel) | DECODED |
| t+40, t+44 | constants **13, 0** — present on every record, used to accept placements whose translation has a coordinate below 1 m (the old "every \|coordinate\| ≥ 1 m" gate dropped real parts near a world axis plane, e.g. wellhead conductors at z = −0.4 m) | DECODED |

**Class flag** — a pure function of the target record:

| value | target | meaning |
|---|---|---|
| 0x40000100 | v95 (+ a few construction v94) | line/datum layer |
| 0x40000102 | v94 | mesh, singleton group (plates/panels) |
| 0x40002100 | v94 | mesh (revolved bodies) |
| 0x40002102 | v94 | mesh (swept bodies) |
| 0x40010100 | AUX | parametric primitive in an all-parametric group |
| 0x40012100 | AUX | parametric co-primitive of a group that also contains a mesh |

The 0x2 / 0x2000 bits do not encode group size or instancing (tested); meaning OPAQUE.

**Partition-first records** (`o%8==4`, one per partition) carry a 68-byte insert between their
group field and the idA/idB slots: `[0][pid][55][1][pid+1][54][ambient RGB f32×3][diffuse RGB
f32×3][0.5,0.5,0.5]` — the partition id and a material (same values as the hierarchy material).
The insert shifts that record's fields: class flag at o−92, group at o−88, pid at o−80,
translation at o+28.

**Rotation is NOT stored** for RVM-loader placements (two orientations of one shape carry
byte-identical tails): orientation is baked into the record vertices and AUX frames.

**Interned placement stream (Revit / DWG / 3DS loaders) — DECODED + VALIDATED**: see the
next section. RVM-loader files never carry this stream.

## Non-RVM loaders: placement FRAMES, instancing, the general node grammar

Evidence: the six freely licensed Revit-loader files
(`convertSamples/nwd/aps-params-test-desks/`,
`convertSamples/nwd/clash-detection-matrix-automation/`); tests in
`rust_src/crates/nwd-core/tests/free_sample_extra.rs`; probe:
`cargo run -p nwd-core --example tree_probe`.

### Placement frames — DECODED + VALIDATED (2026-11-12)

The placement chunk is `[frame count]` followed by FRAMES. A frame is a record of type 13;
the first one has id 100 (so the chunk starts `[count][100][13]…`):

```
[id][13] [pad to 8] [f64 scalar] [w0][w1][class flag][group]
         TRANSFORM slot · MATERIAL slot · FRAGMENT slot
```

A slot is `0` (null), `[1][id]` (back-reference to an earlier record) or an inline
definition:

| slot | inline definition |
|---|---|
| transform | type 14 `t` / 15 `t + quaternion (xyzw)` / 16 `t + quaternion + signed uniform scale` (s = −1 = mirror); 17 = 11 f64, OPAQUE. `world = R(q)·(s·v) + t`. Null ⇒ the fragment's anchor is the translation (the RVM rule). |
| material | type 55 `[33]`, then type 54 (f32 RGB triples: ambient, diffuse, specular) and, in Revit exports, type 185 `[len][material-asset JSON]` |
| fragment | type 93: `[6 f32 bbox][pad 8][3 f64 anchor][2 u32][u32 1-based geometry-record index]` |

**One frame = one placed part. A frame whose fragment slot is a back-reference places the
SAME geometry again under its own transform** — this is how repeated family instances are
stored. Reading only the inline type-93 records (the previous reader) silently dropped every
further instance: the desk sample has 18 frames (6 desks × 3 solids) of which 15 are
references; the sample building's structure has 4,706 frames of which 4,487 are references.

`group` is the owning tree leaf's **1-based ordinal in the instance-EXPANDED depth-first
order** of the hierarchy (the RVM rule generalised: RVM trees have no instancing, so there
the expanded order is the record order).

Checks (all six files): parsed frames == the header's frame count; every frame's group is a
geometry leaf of the expanded tree; **every geometry leaf of the expanded tree owns at least
one frame** (the two streams, parsed independently, are in bijection); on the desk sample a
part's frame translation minus its instance node's translation is the same vector for all six
instances. The five disciplines of the sample building keep one vertical envelope.

| file | frames (declared = parsed) | of which instanced | expanded leaves | GLBs (one per level) |
|---|---|---|---|---|
| `params_test_desks.nwd` | 18 | 15 | 18 | 1 |
| `Structural.nwc` | 4,706 | 4,487 | 638 | 5 |
| `Architectural.nwc` | 4,732 | 1,893 | 1,826 | 8 |
| `Mechanical.nwc` | 191 | 40 | 147 | 2 |
| `Plumbing.nwc` | 172 | 34 | 125 | 2 |
| `Electrical.nwc` | 48 | 0 | 48 | 1 |

### General node grammar — DECODED (Revit loader: complete; DWG / 3DS: partial)

`hierarchy::parse_tree` (strict: any byte that does not fit ⇒ no tree, and the file converts
as one unnamed element, as before). Ids are strictly sequential over ALL definitions, so every
definition must carry exactly the next id — a wrong field length is detected at once.

```
chunk  := [n][n × u32][first_id][root_count]  node × root_count
node   := [id][22 leaf | 53 container] name          name := [len][utf-8, pad 4] | [-1]
          class            [1][id] | [id][52] string string   (display, internal)
          [flags][k][F]    F = number of attribute slots
          slot × F
          [child_count]    containers only
          child × count    node | [1][id] = ANOTHER INSTANCE of node id (whole subtree)
slot   := 0 | [1][id] | definition:
          [id][31] label, class ([0][0] | [1][id] | [id][52] …), pad 8, 14 × f64     material
          [id][39|40|41][-1][0][0x20000] pad 8, 12 | 3 | 7 × f64 (39: + u32)          transform
          [id][200] name [0][0] slot                                                  render material
          [id][185][len][json] [-1][N] 3N × string       asset JSON + texture paths (in a 200)
          [id][86|79] name category [0][count] count × (property value)               property set
category, property := 0 | [1][id] | [id][52] string string
value  := [4] string | [2] i32 | [3] bool | [1|6|7|10|11] pad 8, f64
          | [8] (0 | [1][id] | [id][52] string string)       named constant (e.g. a Revit element)
```

- The RVM node body `[0][k][F]` is this grammar with flags = 0. `flags`: 0x80000 layer/level,
  0xc0000 collection (category / family / type), 0x40000 instance, 0x200000 composite, 0 solid
  (Revit). `k` is non-zero on instances (a per-file running number; OPAQUE).
- **Properties are INLINE** for these loaders (type-86 slots of the node, typed values),
  not in a separate property stream as in RVM-loader files. Value types 1/6/7/10/11 are all
  f64 (plain / length / angle / area / volume by their property names — 7 was not observed
  and is INFERRED from the gap). Not exported yet (`--props` covers RVM-loader files only).
- Slot roles are identified by the definition's type, not its position: an instance node's
  slots are `[transform][200][0][0][0][0][property sets…]`, a composite's
  `[material][property set][200][0]`, a solid's `[material][0][200]`.
- Node transforms (39/40/41) are the instance's own local transform; placement frames carry
  the complete world transform, so the converter does not need them.
- Unfolding: each `[1][id]` child becomes its own run of nodes in the result, with fresh ids
  above the stream's last id, so every instance is a separately selectable element.
- Per-loader coverage: all six public Revit files parse to the last byte. DWG- and
  3DS-sourced streams use further definition types (seen: 66 and 97 = DWG entity attributes /
  render material with texture settings, 182) that are not decoded; those files still convert
  with complete geometry but without a tree. See `docs/GRAMMAR_non_rvm.md`.

### Other notes

- **Units** — DECODED by loader (2026-11-14): Revit-loader geometry and translations are in
  **FEET** (desk sample: one desk is 1563 × 762 × 819 mm; the 3 × 2 grid spacing is
  15.318 ft × 9.278 ft; the sample building is 74 ft = 22.6 m high with 18 ft storeys);
  RVM-loader geometry is metres. No unit factor is stored, so the converter goes by the
  loader — see *Units and the unit scale* below.
- The legacy path's heuristic back-scan candidates (no `[93]` marker) that match no geometry
  and have no extent are not placements and are skipped.
- **NWF** (federation file): no geometry of its own; the XRefTable JSON lists the referenced
  models. The converter returns an empty result whose status file names them.

### Units and the unit scale (`ConvertOptions::unit_scale`)

The output is meant to be in metres. `UnitScale::Auto` (the default) multiplies everything
positional by **0.3048 when the file was written by the Revit loader**, and by 1 otherwise;
`UnitScale::Factor(f)` forces a factor (`1.0` = as stored). CLI: `--units
auto|asis|ft|in|mm|cm|m|<factor>`; wasm: `Options.unit_scale` (0 = automatic). The applied
factor is in `ConvertReport::unit_scale` (wasm report: `unitScale`), and an automatic rescale
adds a line to the status file's `notes` array (present only then — informational, unlike
`warnings`).

- **The loader signal** (`inspect::loaders`): the plugin slot of the File trailer — a
  length-prefixed ASCII string `[len][name, NUL-padded to 4]`, 4-byte aligned, directly in
  front of `[448 | 449][u32][1]`, an f64 block and the source path. Its name is
  `LcNwcLoaderPlugin:<reader>` for a Navisworks file reader (`lcldrvm`, `lcldrevit`) or
  `nwexport<tool>` for the NWC exporter add-in that ran inside the authoring tool
  (`nwexportrevit` — `Structural.nwc` of the sample building was written that way, the other
  four NWCs by the `lcldrevit` reader). An exported / cached NWC repeats the name at the start
  of its first chunk, in front of the export options (`lcldrevit_use_shared_coordinates:1`,
  `nwexportrevit_element_params:2`, …; those keys are not slots). The file counts as Revit when
  at least one slot names a Revit plugin and none names anything else.

  | file | plugin slots | source ext |
  |---|---|---|
  | `HDA-ASB-CD2.nwd` / `HDA-ASB-HA.nwd` / `Huldra_Asbuilt.nwd` | 1 / 10 / 69 × `LcNwcLoaderPlugin:lcldrvm` | `.RVM` |
  | `params_test_desks.nwd` | 1 × `LcNwcLoaderPlugin:lcldrevit` | `.rvt` |
  | `Architectural` / `Electrical` / `Mechanical` / `Plumbing.nwc` | 2 × `LcNwcLoaderPlugin:lcldrevit` (header + trailer) | `.rvt` |
  | `Structural.nwc` | 2 × `nwexportrevit` (header + trailer) | `.rvt` |
  | the two NWFs | none | — |

- **Where it is applied**: one multiplication, in `glb::finalize_append` — where every writer
  (merged, standard, tree) materializes a part's world-space points — directly in front of
  the weld. So the weld grid (`cleanup_precision`), the simplifier, the accessor bounds and the
  merged writer's returned bbox are all in OUTPUT units: a Revit file welds on the same 1 mm
  grid as a metre file. The report / status-file boxes computed from unwelded points are
  scaled by the same factor (`GlbOptions::scale_bbox`). `line_width` is an output length too:
  the crosses are built `line_width / factor` wide in model units. A factor of exactly 1 skips
  all of it — the output bytes of RVM-loader files are unchanged.
- Model-unit constants inside the converter (placeholder-box thickness 12 mm, the legacy
  path's matching tolerances) stay in MODEL units; they only act on RVM-loader files.
- **Still unknown**: (1) no stored unit FACTOR has been found. CANDIDATE, not used: the u32
  after the trailer's `448 | 449` word is 0 in all 80 RVM trailers and 3 in all six Revit
  ones — the same numbers as Meters = 0 / Feet = 3 in the Navisworks API's `Units`
  enumeration, i.e. possibly the file's unit as an ENUM (two values observed; needs a file in
  a third unit to confirm). (2) The unit of DWG- and 3DS-loader files (a DWG can be in any
  unit) — auto leaves them as stored. (3) Files mixing loaders (an NWD assembled from Revit
  and other sources): whether Navisworks folds the per-file unit into the stored transforms
  is not known; auto leaves them as stored, the explicit factor applies to the whole file.

## Hierarchy (LogicalHierarchy chunk) — DECODED

- Header `[n][n × u32 table][first_id=100][root_count]`. **The n-word table = one entry per
  PROPERTY chunk, the number of property blocks in it** (DECODED 2026-11-11). n = 0 gives the
  12-byte `[0][100][root_count]` of writers without a property stream.
- Located structurally (`inspect::looks_like_hierarchy`: the header followed by a first
  record `[first_id+1][22|53|32]`) before any string heuristics — a NWD holding only File nodes
  has no `lcldrvm_container` string and used to be misread as the schema registry.
- Interned records `[id][type][…]`, one contiguous id space per file (ids are file-local). Id
  sanity caps must be derived (`first_id + chunk_len/12`), never fixed.
- Name records: type **53** = container name, **22** = geometry-leaf name (`len==0xFFFFFFFF` ⇒
  unnamed → the node displays as its class: `Cylinder`, `Facet Group`, `Line` — real Navisworks
  tree entries that keep those names), type **32** = File node (below).
- type 52 = class (display + internal string, e.g. `Group`/`lcldrvm_container`).
- type 31 = material: `[id][31][len|-1][label][pad to 8-align][u64 = 0]` then a 14×f64 grid
  `[ambient RGB][diffuse RGB][specular RGB][emissive RGB][shininess][transparency]` at exactly
  `align8(label_end) + 8` (alignment relative to the chunk start). Diffuse = grid[3..6] =
  what the Navisworks material panel shows (VALIDATED against the panel). `len = -1` = no label.
- **Node body**: name record (optional), class slot (inline def or ref `[1][class_id]`), then
  `[0][k][F]` where **F = the number of ATTRIBUTE SLOTS that follow** (0–3 observed). Each slot
  is `0` (null), `[1][id]` (ref) or an inline def. **Slot 0 = material; slot 1 = the node's
  property set** (stored as a null slot, resolved by stream order — see Property stream). Huldra:
  F = 2 on attributed nodes, 1 on material-only leaves (e.g. `POHEDRON`), 0 on unnamed
  primitives. `k` = 0 except on File nodes. Then the child count — carried by containers only
  (name type 53 or 32; type 22 never has one). The tree rebuilds by DFS pre-order.
- **File nodes** (type 32, DECODED 2026-11-11): `[id][32][0][len][name]`, class
  `File`/`LcOaPartition`, a label-less material def, F = 2, `k` = a per-file index (a
  permutation of 1..roots — OPAQUE, probably load order), always a container. They are the
  depth-0 roots of multi-file NWDs (`HA-ARCH.RVM` → `/HA-ARCH` site → …) and NEST in an
  assembly (`HDA-ASB-HA.nwd` → `HA-ARCH.RVM` → site).
- **File trailer**: every File node's subtree is followed by partition metadata — `[2]`, an
  optional light list (type-27 records: zero ambient, RGB, unit direction), the plugin slot
  (`LcNwcLoaderPlugin:lcldrvm`; see *Units and the unit scale* for the other loaders),
  `[449][0][1]`, the source path, an f64 extent block. Its framing varies (light
  count, 4/8-byte padding), so the parser resyncs to the next node record whose id continues
  the interned sequence (bounded scan). Framing details OPAQUE.
- Colour: a node without its own material inherits the nearest ancestor's.
- OPAQUE: the File-node `k`, trailer framing, trailing sentinel.

## Property stream — DECODED + VALIDATED (2026-11-11)

The per-node property tabs Navisworks shows (for RVM-loader files: the PDMS attributes of the
source `.txt`, plus a `PDMS File Comments` tab on File nodes — banner, date, user, MDB).
`properties.rs`, `nwd2glb --props` (JSON Lines).

```
chunk    := block*                          (blocks never straddle chunks)
block    := [id][86|79][-1] category [0][count] count × (propdef value)
category, propdef := [id][52][len][display][len][internal]   inline def
                   | [1][id]                                 back-reference
                   | 0                                       none (category only)
value    := [4][len][utf-8, NUL-padded to 4]                 string
          | [2][i32]                                          integer
```

- The property chunks are the n chunks before the hierarchy chunk counted by the hierarchy
  header table, each holding `table[k]` blocks; ids are interned across all of them.
- **Ownership**: a node with F attribute slots owns the next F−1 blocks in DFS order (slot 0 is
  the material). F = 3 writers store a second, empty type-79 set per node.
- VALIDATED: all 44 Huldra NWDs — every block maps to a node and equals the node's element in
  the source `.txt` exactly (the `props_check.py` row above). The `.txt` also lists elements without
  geometry (DATUM, DRAWING, notes); those never reach the NWD tree.

## Linking (fragment → hierarchy leaf) — DECODED + VALIDATED

- **group id (o−20) = the leaf's 1-based DFS ordinal** (`nodes[g−1]`). It resolves 100% of
  fragments to geometry leaves on every Huldra file, and the resulting per-leaf geometry matches
  the FBX export leaf for leaf. (The older reading `node_id = group + first_id` is REFUTED — it
  lands on containers/material records; a user click-test in Navisworks exposed it.)
- **marker+64 → geometry record** (deterministic).
- The converter uses the ordinal link whenever it resolves ≥ 99% of a file's fragments, and
  routes each fragment to its depth-0 root through it. The old spatial-alignment machinery
  (Needleman-Wunsch DP, marker8 band routing, nearest-leaf sweeps — INFERRED) remains only as a
  fallback for files where the ordinal link does not cover the fragments.
- `NWD_LINK_TRACE=1` prints every fallback attachment decision.

Scene-tree output policy (user-set): mirror the NWD hierarchy exactly; attach meshes directly to
their leaf node; extra co-primitive meshes become UNNAMED child nodes; containers/roots never
carry meshes; unresolvable placements are labeled as such, never guessed onto a leaf.

## Multi-file composition

- A file holds one or more depth-0 roots: RVM sites, or File nodes (one per appended source
  file) in multi-file NWDs; assemblies nest File nodes.
- Composition is additive and exact: geometry record vertex blocks and connectivity streams are
  byte-stable across files; node ids are not (file-local). The assembly's triangle total equals
  the sum of its parts.
- Process each root independently; the converter writes one GLB per depth-0 root, streaming
  each to disk before the next.

## Rendering pipeline (current)

1. v94 records: the decoded stored triangulation, winding from the stored normals (100% of
   Huldra and Revit-sample records; records with a UV block included). A record that fails to decode falls back to geometric reconstruction
   (hull/strip — INFERRED, flagged by `NWD_TRACE=1`).
2. AUX records: Navisworks' 32-segment disc / open-tube tessellation (vertex-exact).
3. v95 records: line segments / X-crosses (only with `--include-line`).
4. Fragments with no record match: a placeholder box from the fragment's own AABB.
5. Colours: the hierarchy material's surface colour (see below), inherited from the nearest
   ancestor; the grid's
   transparency becomes the GLB alpha (`BLEND` material) — Huldra's insulation/obstruction
   NWDs use `Color 207Translucent(0.34)` (transparency 0.341), which Navisworks' FBX exporter
   drops.
6. `status_file.json` header (save date, user@host, source banner): the exact values of the
   NWD's `PDMS File Comments` property set — on the NWD's own File node in the
   `LcOaPartition` metadata chunk (`[100][32][0][name]`, F = 3 with an inline property set),
   else on the first File node of the property stream; a printable-string scan is the
   fallback.

**Surface colour = ambient + diffuse for RVM-loader materials** (DECODED 2026-11-12). The RVM
loader stores each PDMS palette colour C split as `ambient = 0.4·C`, `diffuse = 0.6·C`
(every `Color N` material of the Huldra sample, to 1/255: Color 2 = palette #cc0000 is
ambient #520000 + diffuse #7a0000; Color 12 = #bfbfbf is #4d4d4d + #737373). Using the diffuse
alone rendered every RVM-sourced model 40% too dark. When a grid shows that 2:3 split the
converter writes `ambient + diffuse`, which reproduces the PDMS palette values the RVM → GLB
reference converter (rvm2glb) uses, within rounding. Materials with ambient == diffuse
(Revit loader) keep the diffuse.

**Colours vs the FBX export**: Navisworks' FBX exporter writes yet another RGB per `Color N`
material (e.g. N=2 → (122,26,26), N=244 → (133,0,133)); those values are stored nowhere in
the NWD and are not used.

### Throughput and memory (how the pipeline is laid out)

- Every chunk is inflated at most twice: once by the container walk (to find its end; the
  output is discarded) and once by its consumer. The geometry chain is pinned first from the
  size index (whose header is sniffed by inflating 8 bytes), so classification and the
  placement scan never touch geometry chunks; both run chunk-parallel.
- The geometry stream is never held inflated: `geometry::parse_stream` inflates a group of
  chunks (~8 MB) in parallel, decodes the records complete in that window in parallel and
  slides on. The size index gives every on-disk record's bounds, so the record → mesh / AUX
  table (`GeomIndex`, 4 bytes per record) falls out of the same pass.
- Placements are scanned BEFORE geometry is decoded, and the fragment chunk is released as
  soon as the group-ordinal link is known to hold, so the two largest transients never
  coexist. The per-record coarse primitive fit (linker centroid) and the cloned leaf list
  are built only for the legacy alignment path.
- The merged writer welds parts in parallel batches straight into the output buffer (index
  view laid out at its upper bound, positions appended behind it, the slack closed once);
  the JSON chunk is streamed, and the header + JSON are written in front of the BIN payload
  in the same buffer. One GLB is resident at a time.
- MD5 of each GLB is the one serial pass left: GLBs up to 64 MB are hashed on a background
  thread while the next root is built (at most 64 MB held that way); larger ones are hashed
  beside the file write.
- Output is deterministic: the fallback meshers iterate ordered sets (hash-set iteration
  order used to change triangle order from run to run on files with undecoded records).

`NWD_MEM_TRACE=1` prints RSS and elapsed time at each stage boundary.

## Data ceilings (verified absences — not bugs)

- **World bbox / unit factor / up-vector are not stored** — a full-file scan for f64/f32 runs
  matching a known world bbox found nothing outside vertices/translations. (The unit is
  derived from the loader instead; a possible unit ENUM is noted under *Units and the unit
  scale*.)
- RVM-loader fragment rotation is not stored (baked into vertices); per-leaf instance split
  counts are regenerated by Navisworks at load, not serialized.
- Some tiny source primitives (e.g. weld rods of a few mm radius) are dropped by Navisworks at
  import — no record, no fragment.
- One Huldra insulation/obstruction NWD (`HDA-ASB-HL_insuobst`) holds File nodes but no
  geometry at all; Navisworks' FBX export of it is empty too.

## Open problems

1. **Old-format (`lichunk-007`) placements** — geometry renders at identity.
2. **DWG / 3DS trees** — the general node grammar parses every public Revit file, but
   DWG- and 3DS-sourced hierarchies use definition types that are not decoded yet (66, 97,
   182, and File trailers after the tree); such files convert with complete geometry
   (instances included) but as one unnamed element. Inline properties of non-RVM files are
   parsed but not exported.
3. **Remaining opaque fields**: geometry `[101][60]` magic; fragment w0/w1 and the o−40 scalar;
   class-flag bits 0x2/0x2000; normal-stream opcodes 0xc0–0xcf (never observed); the
   `LcOaPartition` chunk framing; GUID values; registry flags; File-node `k`; the File-trailer
   framing; the meaning of type-79 property sets.
4. **GLB normal export** — stored normals drive winding, but the GLB ships positions only
   (`--include-normals` emits smooth normals). Exporting the decoded per-corner normals needs
   corner-split vertices in the writer.
5. **Units/up-vector**: DONE for the two known loaders — the unit scale is automatic for
   Revit-loader files (feet → metres, all six public Revit files) and 1 for RVM-loader files,
   with an explicit override (`--units`, `ConvertOptions::unit_scale`). STILL OPEN: no stored
   unit factor has been found (a candidate unit enum in the File trailer is unconfirmed); the
   unit of DWG / 3DS-loader files and of files mixing loaders is unknown, so those are left as
   stored unless a factor is given. The up-vector is not stored either (Z up on every file).
6. The pre-codec geometric reconstruction (`faithful_*`, hull, strip) only runs when a
   record fails to decode — never on the test corpora; its two stale tests are ignored.

## Refuted ideas (do not re-explore without new evidence)

- **Connectivity is Edgebreaker/CLERS** — many sessions of symbol-stream framing ("#C = V−3",
  corner refs, frontier ranks) were pattern-matching on the LZ codec's byte distribution.
- `h4 = 2×triangles`; `0x80 = +16 escape`; "0x80 is a single repeat" (it is RLE `0x80+k`);
  `f0 00 00 = section divider`; "PRE is context-relative across files".
- Fragment rotation/scale in the record tail; a stride-188 record variant; the spatial BVH
  chunk as the per-leaf link; idB or marker−8 as node pointers; "no fragment→geometry pointer
  exists" (marker+64 is that pointer); group read at marker+100 (off by one record);
  `node_id = group + first_id` (it is the DFS ordinal).
- "Octahedral 2×i16 normals at marker+12" (the normal stream is an i8 table + token stream).
- Element names imply shape ("FTUBE" is a cable ladder, not a tube).
- "0x40012100 = weld-disc flag" (off-by-one-frame artifact); partition headers as a
  root→leaf-range table (they are partition-first placements with a material insert).
- "F ≠ 0 ⇒ material slot, optionally followed by an extra `[0][0]` pair" (F is a slot count).
- The hierarchy header n-table as "bucket counts" (it counts property blocks per chunk).
- "Every placement coordinate is ≥ 1 m in magnitude" (parts near an axis plane exist).
- AUX kind from word2 (the variant word decides).
- "The size-index is absent in single-geometry-chunk files" (chunk-numbering confusion); the
  viewpoint chunk as a float/param table (it is a saved camera).
