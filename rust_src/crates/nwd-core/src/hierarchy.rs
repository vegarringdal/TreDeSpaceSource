//! Logical scene-graph parser — `LcOpNwdLogicalHierarchy` chunk.
//!
//! The chunk is a flat stream of **attribute records**, each interned with an
//! incrementing u32 id so later nodes can back-reference a shared attribute
//! (e.g. the same class or material) by id instead of re-encoding it:
//!
//! ```text
//!   [id: u32][type: u32][payload depending on type]    (definition)
//!   [id: u32]                                           (back-reference)
//! ```
//!
//! Types observed in RVM-loader files:
//! - `4`  — node/group marker (no string payload).
//! - `53` — **name**: `[len: u32][ascii, NUL-padded to 4-byte alignment]`.
//! - `52` — **class**: two strings (display, e.g. `Group`; internal, e.g.
//!          `lcldrvm_container`).
//! - `31` — **material/appearance**: a label (`Color 1Translucent(0.00)`)
//!          followed by f64 appearance coefficients.
//!
//! Fully modelling the record framing (definitions vs back-references, group
//! push/pop) needs the fragment/spatial stream too, so for now we use a robust
//! **string scan**: every length-prefixed, NUL-padded, 4-byte-aligned ASCII run
//! is a string field; we classify it by content. Validated against the RVM
//! oracle — the extracted name set matches 237/239 oracle node names (the rest
//! are geometry type labels / extractor edge cases). See
//! `docs/what_we_know_v1.md`.

use crate::cursor::Cursor;
use crate::error::Result;

#[derive(Debug, Clone)]
pub struct StringField {
    /// Byte offset of the length prefix within the chunk.
    pub offset: usize,
    pub kind: FieldKind,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    /// User-facing node name, e.g. `/HA-PIPE`, `FLANGE 1 of BRANCH …`.
    Name,
    /// Class string, e.g. `Group` / `lcldrvm_container` / `lcldrvm_cylinder`.
    Class,
    /// Material/appearance label, e.g. `Color 1Translucent(0.00)`.
    Material,
    /// Geometry primitive type label, e.g. `Cylinder`, `Line`, `Facet Group`.
    GeomType,
}

fn classify(text: &str) -> FieldKind {
    if text == "Group" || text.starts_with("lcldrvm_") {
        FieldKind::Class
    } else if text.starts_with("Color ") || text.starts_with("Translucent") {
        FieldKind::Material
    } else if matches!(text, "Cylinder" | "Line" | "Facet Group" | "Box" | "Sphere") {
        FieldKind::GeomType
    } else {
        FieldKind::Name
    }
}

/// Try to read one length-prefixed, NUL-padded, 4-byte-aligned ASCII string at
/// the cursor. Requires length ≥ 2 (length-1 fields collide with the numeric
/// id/type framing) and trailing NUL padding. Leaves the cursor unmoved on miss.
fn try_string(cur: &mut Cursor) -> Option<String> {
    let start = cur.pos();
    let len = cur.u32().ok()? as usize;
    if !(2..=4096).contains(&len) || cur.remaining() < len {
        cur.seek(start);
        return None;
    }
    let bytes = cur.bytes(len).ok()?;
    if !bytes.iter().all(|&b| (0x20..0x7f).contains(&b)) {
        cur.seek(start);
        return None;
    }
    let pad = (4 - (len % 4)) % 4;
    // A real string field is NUL-padded to alignment; an aligned field must be
    // followed by a record boundary (a small id/type), but we don't require that.
    if pad > 0 {
        let tail = cur.peek(pad);
        if tail.first() != Some(&0) {
            cur.seek(start);
            return None;
        }
    }
    let s = String::from_utf8_lossy(bytes).into_owned();
    cur.skip(pad);
    Some(s)
}

/// Extract all string fields from a logical-hierarchy chunk, in stream order.
pub fn parse_strings(chunk: &[u8]) -> Result<Vec<StringField>> {
    let mut cur = Cursor::new(chunk);
    let mut out = Vec::new();
    while cur.remaining() >= 4 {
        let offset = cur.pos();
        if let Some(text) = try_string(&mut cur) {
            let kind = classify(&text);
            out.push(StringField { offset, kind, text });
        } else {
            // Advance one u32 (records are u32-framed) and try again.
            cur.skip(4);
        }
    }
    Ok(out)
}

/// A decoded scene-graph node.
///
/// `display` is the node's own name, or — for an unnamed geometry node — its
/// class string (`Cylinder` / `Facet Group` / `Line`). `geometry` is true for a
/// geometry leaf, false for a container/branch (`child_count > 0`).
#[derive(Debug, Clone)]
pub struct Node {
    /// Global, stream-contiguous record id (101..).
    pub id: u32,
    pub display: String,
    pub geometry: bool,
    pub child_count: u32,
    pub parent_id: Option<u32>,
    pub depth: u32,
    /// Class display string, shared between all nodes of the class.
    pub class: Option<std::sync::Arc<str>>,
    pub color: Option<[f32; 3]>,
    /// Effective opacity = 1 − the material grid's transparency (grid[13]),
    /// inherited exactly like `color`; 1.0 when no material says otherwise.
    /// Huldra's insulation/obstruction NWDs carry `Translucent(0.34)` materials.
    pub opacity: f32,
    /// The node's *own* material-record id (the only other id a node record
    /// carries); `None` when it inherits its ancestor's material. Not a geometry
    /// pointer — the hierarchy holds no node→geometry link (see `docs`/`what_we_know`).
    pub material_id: Option<u32>,
    /// The node's attribute-slot count F (slot 0 = material, slot 1 = the
    /// property set — stored as a null slot, resolved by stream order).
    /// See [`Node::has_properties`].
    pub attr_slots: u32,
}

impl Node {
    /// True if this node owns a block in the property stream: exactly the
    /// nodes with a SECOND attribute slot (F ≥ 2), in DFS order. VALIDATED on
    /// all 44 Huldra NWDs against the source attribute `.txt` files: F = 0
    /// (unnamed class-displayed primitives) and F = 1 (e.g. `POHEDRON` leaves:
    /// material slot only) own none.
    pub fn has_properties(&self) -> bool {
        self.attr_slots >= 2
    }

    /// Number of property-stream blocks this node owns: one per attribute
    /// slot after the material slot (F − 1). Huldra writer: F = 2 → 1 set;
    /// writers with F = 3 store 2 sets (attributes + an empty type-79 set).
    pub fn property_sets(&self) -> u32 {
        self.attr_slots.saturating_sub(1)
    }
}

// Record types in the LogicalHierarchy stream.
const NAME_TYPES: [u32; 2] = [22, 53];
/// File / source-partition node (`LcOaPartition`): `[id][32][0][len][ascii]` —
/// one extra word before the name string. Appears as the depth-0 root of each
/// appended source file in multi-file NWDs (e.g. `HA-ARCH.RVM` inside an area
/// model). Always a container (carries a child count).
const TYPE_FILE: u32 = 32;
const TYPE_CLASS: u32 = 52;
const TYPE_MATERIAL: u32 = 31;
const NONAME_LEN: u32 = 0xFFFF_FFFF;

/// Chunk header: `[n: u32][n × u32 table][first_id: u32][root_count: u32]`.
/// Small files have n = 0 (the classic `[0][100][roots]` 12-byte header);
/// large models carry a table (undecoded — bucket counts?) before the same
/// trailer. Returns (record-stream start, first_id).
/// The hierarchy chunk's first interned id (public probe helper).
pub fn first_id_of(b: &[u8]) -> u32 {
    header(b).1
}

/// The header's n-word table. DECODED (Huldra corpus): one entry per
/// PROPERTY chunk, each the number of property blocks that chunk holds; the
/// entries sum to the number of nodes that [`Node::has_properties`].
pub fn header_table(b: &[u8]) -> Vec<u32> {
    let n = u32le(b, 0) as usize;
    if n < 1_000_000 && 4 + 4 * n + 8 <= b.len() {
        (0..n).map(|i| u32le(b, 4 + 4 * i)).collect()
    } else {
        Vec::new()
    }
}

pub(crate) fn header(b: &[u8]) -> (usize, u32) {
    let n = u32le(b, 0) as usize;
    // Sanity: the table must fit and the trailer's first_id must be small-ish.
    let start = 4 + 4 * n + 8;
    if n < 1_000_000 && start <= b.len() {
        (start, u32le(b, 4 + 4 * n))
    } else {
        (12, u32le(b, 4))
    }
}

fn u32le(b: &[u8], o: usize) -> u32 {
    b.get(o..o + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        .unwrap_or(0)
}

/// Read `[len][ascii NUL-padded to 4]` → (text, next offset).
///
/// `len` is file-supplied: the arithmetic saturates, so an absurd length
/// yields a next offset PAST the buffer (never a wrapped, smaller one — on
/// wasm32 `o + 4 + len` overflows `usize`). Callers that do not pre-check the
/// length must treat `next > b.len()` as a corrupt stream.
fn read_str(b: &[u8], o: usize) -> (String, usize) {
    let ln = u32le(b, o) as usize;
    let start = o.saturating_add(4);
    let raw = b.get(start..start.saturating_add(ln)).unwrap_or(&[]);
    let txt = raw.split(|&c| c == 0).next().unwrap_or(&[]);
    (
        String::from_utf8_lossy(txt).into_owned(),
        start.saturating_add(ln.saturating_add(3) & !3),
    )
}

/// Diffuse RGB from a material's appearance block — EXACT framing (validated
/// byte-for-byte against the Navisworks material panel, 42/42 materials over
/// two models):
///
/// ```text
/// [id][31][len][label]  [pad to 8-byte alignment]  [u64 = 0]
/// [14 × f64: ambient RGB, diffuse RGB, specular RGB, emissive RGB,
///            shininess, transparency]
/// ```
///
/// So the grid starts at `align8(label_end) + 8` — deterministic, no anchor
/// guessing. The old "skip zero words, anchor on the first non-zero" heuristic
/// mis-aligned by one f64 whenever `ambient.red == 0` (e.g. teal materials:
/// it read (diffuse.g, diffuse.b, specular.r) — the user-reported colour bug).
/// The heuristic is kept only as a fallback when the exact grid fails to
/// validate.
fn diffuse_rgb(b: &[u8], start: usize, end: usize) -> Option<[f32; 3]> {
    // `start` is the label end (4-aligned). Exact grid position:
    let g = ((start + 7) & !7) + 8;
    let f64at = |p: usize| -> Option<f64> {
        b.get(p..p + 8)
            .map(|s| f64::from_le_bytes(s.try_into().unwrap()))
    };
    if g + 14 * 8 <= b.len() {
        let vals: Vec<f64> = (0..14).filter_map(|i| f64at(g + 8 * i)).collect();
        if vals.len() == 14 && vals.iter().all(|&v| (0.0..=1.0001).contains(&v)) {
            return Some(surface_colour(&vals));
        }
    }
    diffuse_rgb_heuristic(b, start, end)
}

/// Transparency (grid[13], 0 = opaque) of a material def whose label ends at
/// `label_end` — same exact grid position as [`diffuse_rgb`]. `None` when the
/// grid does not validate.
/// The colour a material's surface shows, from its 14-value grid
/// (`[ambient][diffuse][specular][emissive][shininess][transparency]`).
///
/// Normally that is the DIFFUSE triple. The RVM loader, however, splits each
/// PDMS palette colour C into `ambient = 0.4·C` and `diffuse = 0.6·C`
/// (measured on every `Color N` material of the Huldra sample: e.g. Color 2
/// = palette #cc0000 is stored as ambient #520000 + diffuse #7a0000), so its
/// diffuse alone is 40% too dark. When the grid shows that exact 2:3 split
/// the colour is `ambient + diffuse` — the source palette value, which is
/// also what the RVM → GLB reference converter writes. Loaders that store
/// ambient == diffuse (Revit) keep the diffuse.
fn surface_colour(g: &[f64]) -> [f32; 3] {
    let (a, d) = (&g[0..3], &g[3..6]);
    let split =
        (0..3).all(|k| (a[k] * 3.0 - d[k] * 2.0).abs() < 0.02) && d.iter().any(|&v| v > 0.0);
    if split {
        [0, 1, 2].map(|k| (a[k] + d[k]).min(1.0) as f32)
    } else {
        [d[0] as f32, d[1] as f32, d[2] as f32]
    }
}

fn material_transparency(b: &[u8], label_end: usize) -> Option<f32> {
    let g = ((label_end + 7) & !7) + 8;
    let v = b.get(g + 13 * 8..g + 14 * 8)?;
    let t = f64::from_le_bytes(v.try_into().unwrap());
    (0.0..=1.0).contains(&t).then_some(t as f32)
}

fn diffuse_rgb_heuristic(b: &[u8], start: usize, end: usize) -> Option<[f32; 3]> {
    let u32le = |p: usize| -> u32 {
        b.get(p..p + 4)
            .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
            .unwrap_or(0)
    };
    let f = |p: usize| -> Option<f64> {
        b.get(p..p + 8)
            .map(|s| f64::from_le_bytes(s.try_into().unwrap()))
    };
    let in_rgb = |o: usize| -> Option<[f32; 3]> {
        let (r, g, bl) = (f(o)?, f(o + 8)?, f(o + 16)?);
        (([r, g, bl].iter().all(|&v| (0.0..=1.0001).contains(&v)))
            && (r != 0.0 || g != 0.0 || bl != 0.0))
            .then_some([r as f32, g as f32, bl as f32])
    };
    // Skip the leading zero pad-words to land on the ambient f64; the diffuse
    // triple follows 24 bytes later. Prefer diffuse, fall back to ambient.
    let mut anchor = start;
    while anchor + 4 <= end && u32le(anchor) == 0 {
        anchor += 4;
    }
    if in_rgb(anchor).is_some() {
        return in_rgb(anchor + 24).or_else(|| in_rgb(anchor));
    }
    // Defensive fallback: scan for the first then second in-range run.
    let mut o = start;
    let mut first: Option<usize> = None;
    while o + 24 <= end {
        if in_rgb(o).is_some() {
            match first {
                None => first = Some(o),
                Some(_) => return in_rgb(o),
            }
        }
        o += 8;
    }
    first.and_then(in_rgb)
}

/// Decode the LogicalHierarchy chunk into the scene-graph **tree**, in depth-first
/// pre-order (so the site roots come first, in order).
///
/// Grammar (reverse-engineered, validated against the model): the chunk is an
/// interned attribute table — records `[id][type][len][ascii]` for names
/// (type 22/53; `len == 0xFFFFFFFF` ⇒ an **unnamed** node shown by its class),
/// classes (type 52, two strings), materials (type 31, label + f64 appearance).
/// A node body is `CLASS slot` (ref `[1][class_id]` or inline def) `[0][0]`
/// `MATERIAL slot` (none/ref/def) and — **only for a container** (the branch
/// class) — a trailing `child_count`. A node is a container iff it carries a
/// child-count; the tree is rebuilt by a stack DFS (a container is immediately
/// followed by its `child_count` subtrees). See `docs/what_we_know_v1.md`.
pub fn parse_nodes(chunk: &[u8]) -> Vec<Node> {
    use std::collections::{HashMap, HashSet};
    let b = chunk;
    let n = b.len();
    // Ids are interned sequentially from the header's first_id (offset 4) and
    // every record is at least 12 bytes, so this bounds any real id. A fixed
    // small cap (the old `< 5000`) silently drops everything in large models.
    let (stream_start, first_id) = header(b);
    let id_cap = first_id.saturating_add((n / 12) as u32).saturating_add(100);

    // Pass 1: discover all class definitions (type 52) → id + display string.
    // The container class is the first one defined (the root's class).
    let mut class_display: HashMap<u32, std::sync::Arc<str>> = HashMap::new();
    let mut o = stream_start;
    while o + 12 <= n {
        if u32le(b, o + 4) == TYPE_CLASS && u32le(b, o + 8) < 100 && u32le(b, o) < id_cap {
            let cid = u32le(b, o);
            let (disp, _) = read_str(b, o + 8);
            class_display.entry(cid).or_insert_with(|| disp.into());
        }
        o += 4;
    }
    let all_classes: HashSet<u32> = class_display.keys().copied().collect();
    let container_class = all_classes.iter().copied().min().unwrap_or(102);
    let container_classes: HashSet<u32> = std::iter::once(container_class).collect();

    let at_name = |o: usize| -> bool {
        o + 12 <= n && {
            let (t, ln) = (u32le(b, o + 4), u32le(b, o + 8));
            NAME_TYPES.contains(&t) && u32le(b, o) < id_cap && (ln == NONAME_LEN || ln < 200)
        }
    };
    // `[id][32][0][len][ascii…]` — a File/partition node (see TYPE_FILE).
    let at_file = |o: usize| -> bool {
        o + 20 <= n && u32le(b, o + 4) == TYPE_FILE && u32le(b, o) < id_cap && {
            let ln = u32le(b, o + 12) as usize;
            (1..4096).contains(&ln)
                && b.get(o + 16..o + 16 + ln.min(8))
                    .is_some_and(|s| s.iter().all(|&c| (0x20..0x7f).contains(&c)))
        }
    };
    let at_class_ref =
        |o: usize| o + 8 <= n && u32le(b, o) == 1 && all_classes.contains(&u32le(b, o + 4));
    let at_class_def = |o: usize| {
        o + 12 <= n
            && u32le(b, o + 4) == TYPE_CLASS
            && u32le(b, o) < id_cap
            && u32le(b, o + 8) < 100
    };
    let at_node_start = |o: usize| at_name(o) || at_file(o) || at_class_ref(o) || at_class_def(o);

    struct Raw {
        id: u32,
        name: Option<String>,
        class_id: u32,
        mat_id: Option<u32>,
        cc: u32,
        color: Option<[f32; 3]>,
        transp: Option<f32>,
        slots: u32,
    }
    let mut raw: Vec<Raw> = Vec::new();
    let mut o = stream_start;
    // DFS bookkeeping during the parse: the open containers' remaining child
    // counts, flagged when the container is a File node. A File node's
    // subtree closing is the only place the stream carries a non-node
    // trailer (see the resync below).
    let mut open: Vec<(u32, bool)> = Vec::new();
    let mut after_file = false;
    let mut max_id = first_id;
    while o + 8 <= n {
        // 0. RESYNC across a File trailer. Every File node's subtree is
        // followed by partition metadata (`[2]`, an optional type-27 light
        // list, the loader plugin string `LcNwcLoaderPlugin:lcldrvm`, the
        // source path, an f64 extent block); in an assembly of NWDs, File
        // nodes nest (`HDA-ASB-HA.nwd` → `HA-ARCH.RVM` → site) and trailers
        // follow each level. The framing varies (light count, 4/8-byte
        // padding), so instead of decoding it we skip forward to the next
        // node record whose id continues the interned id sequence. Bounded,
        // so a genuinely ended stream still terminates quickly.
        if after_file && !at_name(o) && !at_file(o) {
            const MAX_TRAILER: usize = 1 << 20;
            let next = |p: usize| {
                (at_file(p) || at_name(p))
                    && (max_id + 1..=max_id.saturating_add(4096)).contains(&u32le(b, p))
            };
            let mut p = o;
            let lim = (o + MAX_TRAILER).min(n);
            while p + 20 <= lim && !next(p) {
                p += 4;
            }
            if p + 20 > lim {
                break;
            }
            o = p;
        }
        after_file = false;
        // 1. NAME (optional). The record TYPE discriminates the node kind:
        // 53 = container (carries a child count), 22 = geometry leaf (never
        // does) — validated on large multi-root models where leaves can carry
        // the container CLASS, so the old class-based cc rule misparses.
        // 32 = File/partition node (container, one extra word before the name).
        let mut id = 0u32;
        let mut name = None;
        let mut name_type = None;
        if at_file(o) {
            id = u32le(b, o);
            name_type = Some(TYPE_FILE);
            let (s, nx) = read_str(b, o + 12);
            name = Some(s);
            o = nx;
        } else if at_name(o) {
            id = u32le(b, o);
            name_type = Some(u32le(b, o + 4));
            let rl = u32le(b, o + 8);
            if rl == NONAME_LEN {
                o += 12;
            } else {
                let (s, nx) = read_str(b, o + 8);
                name = Some(s);
                o = nx;
            }
        }
        max_id = max_id.max(id);
        // 2. CLASS ref or inline def
        let class_id;
        if at_class_ref(o) {
            class_id = u32le(b, o + 4);
            o += 8;
        } else if at_class_def(o) {
            class_id = u32le(b, o);
            max_id = max_id.max(class_id);
            let (_, e1) = read_str(b, o + 8);
            let (_, nx) = read_str(b, e1);
            // The internal-name length is unchecked (only the display
            // string's is, by `at_class_def`): a class def running past the
            // chunk is a corrupt stream, which ends here. Clamped, `o` can
            // only move forward — unclamped it wraps backwards on wasm32 and
            // the loop never terminates while `raw` grows.
            o = nx.min(n);
        } else {
            break; // end of node stream
        }
        // 3. `[0][k][F]` — F = the number of ATTRIBUTE SLOTS that follow
        // (0–3 observed; Huldra: 2 on attributed nodes, 1 on material-only
        // leaves, 0 on unnamed primitives). k is 0 on ordinary nodes; on File
        // nodes it is a per-file index (a permutation of 1..roots — OPAQUE,
        // probably load order).
        o += 8;
        let n_slots = u32le(b, o);
        o += 4;
        // 4. SLOTS. Each is `0` (null), `[1][id]` (reference to an interned
        // record) or an inline definition `[id][type]…`. Slot 0 is the
        // MATERIAL (corpus-wide; later slots have only ever been null).
        // Material def: `[id][31][len|-1][label]` → pad to 8 → u64 0 →
        // 14×f64 appearance grid (see `diffuse_rgb`). Unknown inline defs
        // fall back to the old scan-to-next-node heuristic.
        let mut mat_id = None;
        let mut color = None;
        let mut transp = None;
        let mut scanned = false; // cc already consumed by the fallback scan
        for si in 0..n_slots.min(16) {
            if o + 4 > n {
                break;
            }
            let w = u32le(b, o);
            if w == 0 {
                o += 4;
            } else if w == 1 {
                if si == 0 {
                    mat_id = Some(u32le(b, o + 4));
                }
                o += 8;
            } else if o + 12 <= n && u32le(b, o + 4) == TYPE_MATERIAL && w < id_cap {
                if si == 0 {
                    mat_id = Some(w);
                }
                max_id = max_id.max(w);
                let ln = u32le(b, o + 8);
                let label_end = if ln == NONAME_LEN {
                    o + 12
                } else {
                    (o + 12).saturating_add((ln as usize).saturating_add(3) & !3)
                };
                // File-supplied label length: past the chunk = corrupt stream,
                // which ends here (unchecked, `o` wraps backwards on wasm32
                // and the loop never terminates).
                if label_end > n {
                    o = n;
                    break;
                }
                let grid = ((label_end + 7) & !7) + 8;
                let end = grid + 14 * 8;
                if si == 0 {
                    color = diffuse_rgb(b, label_end, end.min(n));
                    transp = material_transparency(b, label_end);
                }
                o = end;
            } else {
                // Unknown slot payload: scan to the next node start (old
                // behaviour); the child count, if any, is the word before it.
                let mut p = o + 4;
                while p + 4 <= n && !at_node_start(p) {
                    p += 4;
                }
                o = p;
                scanned = true;
                break;
            }
        }
        // 5. CHILD-COUNT — containers only (name type 53 or 32; nameless
        // nodes fall back to the class rule).
        let is_container = match name_type {
            Some(t) => t == 53 || t == TYPE_FILE,
            None => container_classes.contains(&class_id),
        };
        let cc = if is_container {
            if scanned {
                u32le(b, o - 4)
            } else {
                let c = u32le(b, o);
                o += 4;
                c
            }
        } else {
            0
        };
        // DFS bookkeeping (mirrors the tree build below).
        if let Some(top) = open.last_mut() {
            top.0 -= 1;
        }
        if cc > 0 {
            open.push((cc, name_type == Some(TYPE_FILE)));
        } else if name_type == Some(TYPE_FILE) {
            after_file = true; // childless File node: its trailer follows now
        }
        while let Some(&(0, is_file)) = open.last() {
            open.pop();
            after_file |= is_file;
        }
        raw.push(Raw {
            id,
            name,
            class_id,
            mat_id,
            cc,
            color,
            transp,
            slots: n_slots,
        });
    }

    // Propagate inline-defined material colours to nodes that only reference the id.
    let mut mat_color: HashMap<u32, ([f32; 3], f32)> = HashMap::new();
    for r in &raw {
        if let (Some(c), Some(m)) = (r.color, r.mat_id) {
            mat_color
                .entry(m)
                .or_insert((c, 1.0 - r.transp.unwrap_or(0.0)));
        }
    }

    // Build the tree (depth-first pre-order) with a stack of (id, remaining).
    let mut out = Vec::with_capacity(raw.len());
    let mut stack: Vec<(u32, u32)> = Vec::new();
    for r in raw {
        while matches!(stack.last(), Some(&(_, 0))) {
            stack.pop();
        }
        let parent_id = stack.last().map(|&(id, _)| id);
        let depth = stack.len() as u32;
        if let Some(top) = stack.last_mut() {
            top.1 -= 1;
        }
        let class = class_display.get(&r.class_id).cloned();
        let display = r
            .name
            .or_else(|| class.as_deref().map(str::to_string))
            .unwrap_or_else(|| "Object".into());
        let own = match r.color {
            Some(c) => Some((c, 1.0 - r.transp.unwrap_or(0.0))),
            None => r.mat_id.and_then(|m| mat_color.get(&m).copied()),
        };
        if r.cc > 0 {
            stack.push((r.id, r.cc));
        }
        out.push(Node {
            id: r.id,
            display,
            geometry: r.cc == 0,
            child_count: r.cc,
            parent_id,
            depth,
            class,
            color: own.map(|(c, _)| c),
            opacity: own.map_or(f32::NAN, |(_, a)| a), // NaN = inherit (resolved below)
            material_id: r.mat_id,
            attr_slots: r.slots,
        });
    }

    // Colour inheritance: a node with no own material shows its nearest ancestor's
    // colour (how Navisworks renders it). Nodes are in DFS pre-order, so a parent's
    // effective colour is resolved before its children.
    let mut eff: HashMap<u32, ([f32; 3], f32)> = HashMap::new();
    for nd in out.iter_mut() {
        let own = nd.color.map(|c| (c, nd.opacity));
        let e = own.or_else(|| nd.parent_id.and_then(|p| eff.get(&p).copied()));
        nd.color = e.map(|(c, _)| c);
        nd.opacity = e.map_or(1.0, |(_, a)| a);
        if let Some(e) = e {
            eff.insert(nd.id, e);
        }
    }

    out
}

/// The scene tree of a NON-RVM file (Revit / DWG / 3DS loaders), with
/// instanced subtrees unfolded: see [`parse_tree`].
#[derive(Debug, Clone, Default)]
pub struct Tree {
    /// Nodes in instance-EXPANDED depth-first pre-order. A placement frame's
    /// group word is a 1-based index into this list
    /// (`fragments::InternedFrag::group`).
    pub nodes: Vec<Node>,
    /// Per node: the translation of its own transform slot, if it has one
    /// (an instance node's position; placements carry their own complete
    /// transforms, so this is informational / a cross-check).
    pub translations: Vec<Option<[f64; 3]>>,
    /// Number of child slots that referenced an already defined node (each
    /// one unfolds into a further copy of that subtree).
    pub instance_refs: usize,
}

/// STRICT parser for the general node grammar (every loader except the RVM
/// one, which `parse_nodes` handles together with its File trailers).
/// Returns `None` on the first byte that does not fit, so a caller can fall
/// back to converting without a tree — a partial tree would mislink parts.
///
/// ```text
/// chunk  := [n][n × u32][first_id][root_count]  node × root_count
/// node   := [id][22 leaf | 53 container] name          name := [len][utf-8, pad 4] | [-1]
///           class            [1][id] | [id][52] string string
///           [flags][k][F]    F = number of attribute slots
///           slot × F
///           [child_count]    containers (53) only
///           child × count    node | [1][id] = ANOTHER INSTANCE of node id
/// slot   := 0 | [1][id] | definition:
///           [id][31] label, class ([0][0] | [1][id] |     material
///                 [id][52] string string), pad 8, 14 × f64
///           [id][39|40|41][-1][0][0x20000] pad 8,         transform: 3×3 + t |
///                 12 | 3 | 7 × f64 (39: + u32)            t | t + quaternion
///           [id][200] name [0][0] slot                    render material; its slot is
///           [id][185][len][json] [-1][N] 3N × string      the asset JSON + texture paths
///           [id][86|79] name category [0][count]          property set
///                 count × (property value)
/// category, property := 0 | [1][id] | [id][52] string string
/// value  := [4] string | [2] i32 | [3] bool | [1|6|7|10|11] pad 8, f64
///           | [8] (0 | [1][id] | [id][52] string string)   named constant
/// ```
///
/// Ids are strictly sequential over ALL definitions (nodes, classes,
/// materials, property names …), which is what makes the parse checkable:
/// every definition must carry exactly the next id. VALIDATED on the six
/// freely licensed Revit-loader files (`convertSamples/nwd/`): each stream is consumed
/// to its end, and every placement frame's group word lands on a geometry
/// leaf of the expanded tree.
///
/// Instancing: a child `[1][id]` re-uses an earlier node's whole subtree. The
/// result unfolds it — each occurrence becomes its own run of nodes (fresh
/// ids above the stream's last id, so element ids stay unique) because
/// placements address the expanded order.
pub fn parse_tree(chunk: &[u8]) -> Option<Tree> {
    use std::collections::HashMap;
    struct Def {
        id: u32,
        leaf: bool,
        name: Option<String>,
        class: Option<u32>,
        material: Option<u32>,
        translation: Option<[f64; 3]>,
        slots: u32,
        children: Vec<usize>,
    }
    struct Rd<'a> {
        b: &'a [u8],
        o: usize,
        next_id: u32,
        defs: Vec<Def>,
        node_of: HashMap<u32, usize>,
        class_name: HashMap<u32, std::sync::Arc<str>>,
        /// material id -> (diffuse, opacity)
        materials: HashMap<u32, Option<([f32; 3], f32)>>,
        refs: usize,
    }
    impl Rd<'_> {
        fn peek(&self) -> Option<u32> {
            self.b
                .get(self.o..self.o + 4)
                .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
        }
        fn u(&mut self) -> Option<u32> {
            let v = self.peek()?;
            self.o += 4;
            Some(v)
        }
        fn align8(&mut self) {
            self.o = (self.o + 7) & !7;
        }
        fn f64(&mut self) -> Option<f64> {
            let s = self.b.get(self.o..self.o + 8)?;
            self.o += 8;
            Some(f64::from_le_bytes(s.try_into().unwrap()))
        }
        /// `[len][bytes, padded to 4]`; `[-1]` = no string.
        fn string(&mut self) -> Option<Option<String>> {
            let ln = self.u()?;
            if ln == NONAME_LEN {
                return Some(None);
            }
            let ln = ln as usize;
            if ln > 1 << 20 {
                return None;
            }
            let raw = self.b.get(self.o..self.o + ln)?;
            let txt = raw.split(|&c| c == 0).next().unwrap_or(&[]);
            self.o += (ln + 3) & !3;
            Some(Some(String::from_utf8_lossy(txt).into_owned()))
        }
        /// The id word of a definition: must be exactly the next id.
        fn new_id(&mut self) -> Option<u32> {
            let id = self.u()?;
            (id == self.next_id).then(|| {
                self.next_id += 1;
                id
            })
        }
        fn at_def(&self) -> bool {
            self.peek() == Some(self.next_id)
        }
        /// `[1][id]` | `[id][52] string string` -> the class / name id.
        fn named(&mut self) -> Option<u32> {
            if !self.at_def() {
                (self.u()? == 1).then_some(())?;
                return self.u();
            }
            let id = self.new_id()?;
            (self.u()? == TYPE_CLASS).then_some(())?;
            let display = self.string()?;
            self.string()?;
            if let Some(d) = display {
                self.class_name.insert(id, d.into());
            }
            Some(id)
        }
        fn value(&mut self) -> Option<()> {
            match self.u()? {
                4 => self.string().map(|_| ()),
                2 | 3 => self.u().map(|_| ()),
                1 | 6 | 7 | 10 | 11 => {
                    self.align8();
                    self.f64().map(|_| ())
                }
                8 => {
                    if self.peek()? == 0 {
                        self.o += 4;
                        Some(())
                    } else {
                        self.named().map(|_| ())
                    }
                }
                _ => None,
            }
        }
        /// One attribute slot. Returns what it was, for the node.
        fn slot(&mut self, depth: u32) -> Option<Slot> {
            if depth > 8 {
                return None;
            }
            if !self.at_def() {
                return match self.u()? {
                    0 => Some(Slot::Null),
                    1 => self.u().map(Slot::Ref),
                    _ => None,
                };
            }
            let id = self.new_id()?;
            match self.u()? {
                TYPE_MATERIAL => {
                    self.string()?;
                    // The material's own class: `[0][0]` (none), `[1][id]`
                    // or an inline class definition (DWG loader:
                    // `LcOpDwgMaterial`) — then the grid, 8-aligned.
                    if self.at_def() {
                        self.named()?;
                    } else if matches!(self.peek()?, 0 | 1) {
                        self.o += 8;
                    } else {
                        return None;
                    }
                    self.align8();
                    let mut g = [0.0f64; 14];
                    for x in g.iter_mut() {
                        *x = self.f64()?;
                    }
                    // [ambient][diffuse][specular][emissive][shininess][transparency]
                    let m = g
                        .iter()
                        .all(|v| (0.0..=1.0001).contains(v))
                        .then(|| (surface_colour(&g), 1.0 - g[13] as f32));
                    self.materials.insert(id, m);
                    Some(Slot::Material(id))
                }
                t @ 39..=41 => {
                    self.o += 12;
                    self.align8();
                    let n = match t {
                        39 => 12,
                        40 => 3,
                        _ => 7,
                    };
                    let mut v = [0.0f64; 12];
                    for x in v.iter_mut().take(n) {
                        *x = self.f64()?;
                    }
                    if t == 39 {
                        self.u()?;
                    }
                    // type 39 = 3×3 rows then translation; 40 / 41 lead with it
                    let tr = if t == 39 {
                        [v[9], v[10], v[11]]
                    } else {
                        [v[0], v[1], v[2]]
                    };
                    Some(Slot::Transform(tr))
                }
                200 => {
                    self.string()?;
                    (self.u()? == 0 && self.u()? == 0).then_some(())?;
                    self.slot(depth + 1)?;
                    Some(Slot::Other)
                }
                185 => {
                    let ln = self.u()? as usize;
                    self.o = self.o.checked_add((ln + 3) & !3)?;
                    self.string()?.is_none().then_some(())?;
                    let n = self.u()?;
                    if n > 100_000 {
                        return None;
                    }
                    for _ in 0..3 * n {
                        self.string()?;
                    }
                    Some(Slot::Other)
                }
                86 | 79 => {
                    self.string()?;
                    if self.peek()? == 0 {
                        self.o += 4;
                    } else {
                        self.named()?;
                    }
                    (self.u()? == 0).then_some(())?;
                    let count = self.u()?;
                    if count > 1_000_000 {
                        return None;
                    }
                    for _ in 0..count {
                        self.named()?;
                        self.value()?;
                    }
                    Some(Slot::Other)
                }
                _ => None,
            }
        }
        /// One node definition (recursive over inline children). Returns its
        /// index in `defs`.
        fn node(&mut self, depth: u32) -> Option<usize> {
            if depth > 256 {
                return None;
            }
            let id = self.new_id()?;
            let ty = self.u()?;
            if !NAME_TYPES.contains(&ty) {
                return None;
            }
            let name = self.string()?;
            let class = self.named()?;
            self.o += 8; // flags, k
            let n_slots = self.u()?;
            if n_slots > 64 {
                return None;
            }
            let (mut material, mut translation) = (None, None);
            for _ in 0..n_slots {
                match self.slot(0)? {
                    Slot::Material(m) => material = material.or(Some(m)),
                    Slot::Ref(r) if self.materials.contains_key(&r) => {
                        material = material.or(Some(r))
                    }
                    Slot::Transform(t) => translation = Some(t),
                    _ => {}
                }
            }
            let leaf = ty == 22;
            let cc = if leaf { 0 } else { self.u()? };
            if cc as usize > self.b.len() / 8 {
                return None;
            }
            let me = self.defs.len();
            self.defs.push(Def {
                id,
                leaf,
                name,
                class: Some(class),
                material,
                translation,
                slots: n_slots,
                children: Vec::with_capacity(cc as usize),
            });
            self.node_of.insert(id, me);
            for _ in 0..cc {
                let child = if self.peek()? == 1 {
                    self.o += 4;
                    let target = self.u()?;
                    self.refs += 1;
                    *self.node_of.get(&target)?
                } else {
                    self.node(depth + 1)?
                };
                self.defs[me].children.push(child);
            }
            Some(me)
        }
    }
    enum Slot {
        Null,
        Ref(u32),
        Material(u32),
        Transform([f64; 3]),
        Other,
    }

    let (stream_start, first_id) = header(chunk);
    let roots_n = u32le(chunk, stream_start.checked_sub(4)?);
    if roots_n == 0 || roots_n as usize > chunk.len() / 12 {
        return None;
    }
    let mut rd = Rd {
        b: chunk,
        o: stream_start,
        next_id: first_id + 1,
        defs: Vec::new(),
        node_of: HashMap::new(),
        class_name: HashMap::new(),
        materials: HashMap::new(),
        refs: 0,
    };
    let mut roots = Vec::with_capacity(roots_n as usize);
    for _ in 0..roots_n {
        roots.push(rd.node(0)?);
    }
    // The stream must end here (a few bytes of padding at most).
    if chunk.len() - rd.o.min(chunk.len()) > 16 {
        return None;
    }

    // Unfold instances into DFS pre-order.
    const MAX_NODES: usize = 50_000_000;
    let mut tree = Tree {
        instance_refs: rd.refs,
        ..Tree::default()
    };
    let mut seen = vec![false; rd.defs.len()];
    let mut fresh = rd.next_id; // ids for the 2nd+ copies of a node
                                // (def index, parent node id, depth, inherited colour)
    let mut stack: Vec<(usize, Option<u32>, u32, Option<([f32; 3], f32)>)> =
        roots.iter().rev().map(|&r| (r, None, 0, None)).collect();
    while let Some((di, parent_id, depth, inherited)) = stack.pop() {
        if tree.nodes.len() >= MAX_NODES || depth > 512 {
            return None;
        }
        let d = &rd.defs[di];
        let id = if std::mem::replace(&mut seen[di], true) {
            fresh += 1;
            fresh - 1
        } else {
            d.id
        };
        let class = d.class.and_then(|c| rd.class_name.get(&c).cloned());
        let own = d
            .material
            .and_then(|m| rd.materials.get(&m).copied().flatten());
        let eff = own.or(inherited);
        tree.nodes.push(Node {
            id,
            display: d
                .name
                .clone()
                .or_else(|| class.as_deref().map(str::to_string))
                .unwrap_or_else(|| "Object".into()),
            geometry: d.leaf,
            child_count: d.children.len() as u32,
            parent_id,
            depth,
            class,
            color: eff.map(|(c, _)| c),
            opacity: eff.map_or(1.0, |(_, a)| a),
            material_id: d.material,
            attr_slots: d.slots,
        });
        tree.translations.push(d.translation);
        for &c in d.children.iter().rev() {
            stack.push((c, Some(id), depth + 1, eff));
        }
    }
    Some(tree)
}

/// The de-duplicated, sorted set of user-facing node names.
pub fn node_names(chunk: &[u8]) -> Result<Vec<String>> {
    let mut names: Vec<String> = parse_strings(chunk)?
        .into_iter()
        .filter(|f| f.kind == FieldKind::Name)
        .map(|f| f.text)
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inspect::{classify_all, ChunkKind};

    /// A class def whose second (internal-name) string claims an absurd
    /// length must end the node stream, never move the offset backwards
    /// (on wasm32 the unchecked `o + 4 + len` wrapped and looped forever).
    #[test]
    fn class_def_with_absurd_string_length_ends_the_stream() {
        let ascii = |s: &[u8; 4]| u32::from_le_bytes(*s);
        let words: [u32; 12] = [
            // Header `[0][first_id = 100][roots = 1]`.
            0,
            100,
            1,
            // Name record `[id][53][len]"ROOT"`.
            100,
            53,
            4,
            ascii(b"ROOT"),
            // Class def `[id][52][len]"Group"` + pad, then the corrupt length.
            101,
            TYPE_CLASS,
            5,
            ascii(b"Grou"),
            ascii(b"p\0\0\0"),
        ];
        let mut b: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        let bad = b.len();
        b.extend_from_slice(&0xFFFF_FFF0u32.to_le_bytes());

        let (_, next) = read_str(&b, bad);
        assert!(
            next > b.len(),
            "an oversized string must end past the buffer"
        );

        let nodes = parse_nodes(&b);
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].display, "ROOT");
    }

    /// End-to-end on the Huldra sample (`convertSamples/nwd/huldra/`): crack the
    /// container, find the logical hierarchy, and confirm
    /// the name scan recovers every node name the Navisworks FBX export has.
    #[test]
    fn hierarchy_names_match_fbx() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../convertSamples/nwd/huldra/HDA-ASB-CD2.nwd"
        );
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let container = crate::parse(&bytes).expect("parse");
        let infos = classify_all(&container);
        let hier = infos
            .iter()
            .find(|i| i.kind == ChunkKind::LogicalHierarchy)
            .expect("a logical-hierarchy chunk");
        let names = node_names(&container.data(hier.index)).expect("names");

        // The FBX export has 754 models with 754 distinct names.
        assert_eq!(names.len(), 754);
        assert!(names.iter().any(|n| n == "/CD2-PSUP"), "missing root");
        // A representative component leaf must be present.
        assert!(names
            .iter()
            .any(|n| n.starts_with("SCTN 1 of FRMWORK 1 of STRUCTURE")));
    }
}
