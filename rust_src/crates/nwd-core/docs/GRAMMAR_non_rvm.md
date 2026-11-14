# Non-RVM Navisworks LogicalHierarchy + placement-stream grammar (byte-exact)

Validated primarily on a 3DS-loader model ("3DS-A", a stadium) against its
machine-readable 3DS ground truth; cross-checked on a second 3DS-loader model
("3DS-B"), two DWG-loader models ("DWG-A", "DWG-B") and the RVM corpus. The
test files are private and not part of this repository.

> **Status (2026-11-12):** sections 1–2 below are the first reading, kept for their
> validation numbers. They are superseded by the unified description in
> `docs/what_we_know_v1.md` ("Non-RVM loaders: placement FRAMES, instancing, the general node
> grammar"), which is what the code implements:
> - the placement chunk is a list of FRAMES (type-13 records) with transform / material /
>   fragment SLOTS; a frame whose fragment slot is a back-reference is a further INSTANCE —
>   the "stream of flat groups" below missed those, which is also the "keyframer instancing"
>   remainder in section 3;
> - the node body is `[flags][k][F]` + F typed slots (transform, material, property sets …),
>   not a fixed "flags, transform slot, material tail";
> - children can be `[1][id]` references (instanced subtrees), and a frame's group word is
>   the leaf's ordinal in the instance-expanded DFS order.
>
> Still open for the DWG loader: definition types 66 / 97 / 98 / 182 inside node slots.

## 0. Framing technique (all interned streams)

Every chunk of this family is a flat stream of **interned records**
`[id: u32][type: u32][payload]` with **strictly sequential ids** (first_id+1,
first_id+2, ...). This makes byte-exact segmentation trivial and loader-agnostic:
scan u32-aligned positions for `u32 == next_expected_id && u32@+4 < 100`.
All f64 blocks are **8-byte aligned relative to the chunk start** (a 4-byte zero
pad is inserted when needed) — the source of ±4 span variance between records.

## 1. Hierarchy chunk (3DS-A chunk_90, 3DS-B chunk_23; class LcOp3dsNode)

Header (3DS loader): `[flag=0 u32][first_id=100 u32][root_count u32]` (12 bytes).
DWG loader (DWG-B chunk_06, DWG-A chunk_22): 16-byte header
`[1][?][first_id=100][root_count]` (DWG-B `[1][30][100][6]`, DWG-A `[1][1942][100][59]`).
(RVM/lcldrvm files additionally allow `[n][n×u32 table][first_id][root_count]` —
see docs/what_we_know_v1.md Hierarchy section.)

Record types (3DS-A histogram over 12546 records):

| type | count | meaning |
|------|-------|---------|
| 53   | 4935  | container-node name (`len==0xFFFFFFFF` = unnamed) |
| 22   | 2594  | geometry-leaf-node name (same encoding) |
| 52   | 5     | class def: `[len][disp][len][internal]`, e.g. `Object`/`LcOp3dsNode`, `Mesh Set`/`LcOp3dsMeshSet`, `Composite Part`/`lcodpcoll_collapse_composite_part`, `Material`/`LcOp3dsMaterial`, `Mesh`/`LcOp3dsGeometry` |
| 31   | 169   | material def: `[len][label]` + class slot + f64 colour grid (ambient/diffuse/specular RGB triples) |
| 39   | 2082  | **transform: 3x3 rotation matrix (rows) + translation** — `[0xFFFFFFFF][0 u32][0x00020000 u32][align8][12 f64: r00 r01 r02 r10 r11 r12 r20 r21 r22 tx ty tz][u32 0|1 opaque]` |
| 40   | 2476  | **transform: translation only** — same prefix, `[3 f64: tx ty tz]` |
| 41   | 285   | **transform: translation + quaternion** — same prefix, `[7 f64: tx ty tz qx qy qz qw]` (xyzw order, column-vector convention `world = R·v + t`) |

### Node body (3DS loader), in stream order

```
NAME record (type 53 container / 22 leaf; the 53-vs-22 discriminator holds)
CLASS slot:      inline def record (type 52)  |  ref [1][class_id]
FLAGS:           2×u32 (observed 0x00040000/0 for Object, 0x00200000/0 for Mesh Set,
                 0/0 for leaves; opaque)
TRANSFORM slot:  [0] = none | [1] + inline def record (type 39/40/41)
                 (type-39 payload ends with one extra u32 ∈ {0,1}, opaque)
MATERIAL slot + CHILD COUNT (length-disambiguated tail; observed encodings):
  []                      -> no material, cc = 0
  [cc]                    -> no material
  [1][1][mat_id]          -> material back-ref, cc = 0
  [1][1][mat_id][cc]      -> material back-ref + children (rare)
  [1] + 31-def record...  -> inline material def, cc = 0 (all 169 observed)
```

**Child-count rule:** cc is the *first* tail word only when the tail is a single
word; when a material ref `[1][1][mid]` is present the node has cc=0 unless a 4th
word follows. Validation on 3DS-A: sum(cc) = 7279 = nodes(7529) − roots(250)
exactly; DFS stack balances to 0 with exactly 250 depth-0 roots. Tree = DFS
pre-order with child counts (same as RVM).

### Semantics (validated against the 3DS)

- 7529 nodes = 4843 `Object` (53) + 92 `Mesh Set` (53) + 2586 `Mesh` (22) + 8
  `Composite Part` (22). The 4843 Object nodes correspond **1:1** to the 3DS
  keyframer (KFDATA 0xB002) nodes — count matches exactly.
- Name coverage: 2340/2344 3DS object names appear in the hierarchy (missing 4 are
  keyframer-only dummies/views). 3DS 10-char name truncation visible throughout.
- The 39/40/41 transforms are the keyframer **local** node transforms; composing
  them down the tree (`W = W_parent · M`, column-vector) reproduces the 3DS 0x4160
  pivot matrix exactly for the objects whose pivot Navisworks kept (545/2340;
  e.g. the `24st - Sli` chain: 41-then-39 composition matches the 4160 matrix and
  origin to 6 decimals). For the rest Navisworks re-anchors the local frame, so
  full world placement comes from the placement stream (below), which stores the
  final composed transforms.

### DWG-loader variant (DWG-A, DWG-B)

Same interned record scheme, ids sequential, same 22/53/52/31 types
(classes `LcDWGNwcLayer`, `LcOpDwgPolyFaceMesh`, `LcOpDwgEntityAttrib`; plus new
attribute types 66 and 98 in the entity-attribute chunk). Node body flags value
0x00080000; the material/cc tail layout differs from the 3DS variant (cc rule not
finalized — DWG-B parses 18 nodes but the layer child counts are not yet
extracted). DWG-A hierarchy = chunk_22 (2661 name records); DWG-B = chunk_06.

## 2. Placement chunk (3DS-A chunk_91) — also an interned stream

Header: `[record_count=7475][first_id=100][13][0]...`; ids sequential from 101.
NOTE: the header count word is NOT the record count (7475 vs 19,152 actual) —
walk the sequential-id chain to the end of the chunk.

| type | count | meaning |
|------|-------|---------|
| 13   | 7474  | **scene-node close record**: `[0?][f64 radius?][u32][4][0x2101/2/3 flags][u32 link]` (link ranges over the hierarchy-chunk record index space; exact mapping opaque) |
| 14   | 955   | world transform, translation only: `[align8][3 f64]` |
| 15   | 3081  | world transform, translation + quaternion: `[align8][7 f64: t3, q xyzw]` |
| 16   | 3401  | world transform, translation + quaternion + **signed uniform scale**: `[align8][8 f64: t3, q xyzw, s]` (s = −1.0 for 2977 of them = the mirrored stadium quadrants; also 0.1/10/1000 = unit rescales) |
| 17   | 37    | transform, 11 f64, undecoded |
| 54   | 151   | material: f32 RGB triples (ambient/diffuse/specular) |
| 55   | 151   | material header/link (12 bytes) |
| 93   | 3901  | **fragment**: `[6 f32 local bbox][align8][3 f64 anchor point][u32×2 opaque][u32 geometry-record index, 1-based]` |

Stream is FLAT groups in fixed order: `transform, (55,54 materials)?, 93-fragments*,
13-close` — a stack simulation never exceeds depth 1. A fragment binds to the
nearest **preceding** transform record.

**Geometry link:** the fragment's last u32 is the 1-based index into the decoded
geometry-record array (`geometry::parse` order). Verified: record local bbox ==
fragment bbox for 399/399 sampled fragments.

**Placement math:** `world = R(q) · (s·v) + t` with q in xyzw order, column
vectors, s from type 16 (else 1). NOT the fragment anchor: the 3-f64 field in the
93 record is an anchor/pivot point, not a translation (using it as a translation
is the old 0.5%-match bug).

## 3. Validation numbers (3DS-A vs its 3DS)

- name coverage: 2340/2344 (99.8%).
- hierarchy structure: cc-sum and root-count exact; DFS balanced (100%).
- composed hierarchy transform == 3DS 0x4160 pivot: 545/2340 exact (<1e-3).
- placement-transform vertex test (world = R·(s·v)+t on decoded record vertices,
  tolerance ~2 units): 969/3901 fragments reproduce their 3DS object's vertices
  essentially perfectly; **30.7% of all 606 169 3DS vertices** are reproduced,
  443/2340 objects fully. The failing remainder is dominated by (a) 3DS
  **keyframer instancing** — the raw 3DS mesh coordinates are NOT the displayed
  positions for keyframer-transformed/instanced objects (chairs, trees, roof
  petals), so the naive ground truth itself is wrong there — and (b) type-16
  mirror placements landing between the many near-identical petal instances.
  For a type-16 fragment the stored quaternion+scale was recovered EXACTLY
  (to 5 decimals) by correspondence-free fitting against a real petal object,
  so the formula is right; only instance attribution vs the keyframer remains.

## 4. Per-file coverage

| file  | hierarchy chunk | header | nodes | roots | parse |
|-------|-----------------|--------|-------|-------|-------|
| 3DS-A | chunk_90 | [0][100][250] | 7529 | 250/250 | full, cc exact |
| 3DS-B | chunk_23 | [0][100][46]  | 6022 | 34 found (hdr 46), cc-sum off by 20 | ~99%, tail-rule edge cases remain |
| DWG-A | chunk_22 | [1][1942][100][59] | 2661 names | — | records segment cleanly; DWG body variant, cc rule TBD |
| DWG-B | chunk_06 | [1][30][100][6] | 18 | 6 (hdr) | records + names/classes OK; DWG cc rule TBD |
| RVM   | — | RVM grammar (see docs/what_we_know_v1.md) — unchanged, no transform records |
