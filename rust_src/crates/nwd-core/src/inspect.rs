//! Chunk classification — Phase 1 recon.
//!
//! Chunks are packed without an explicit per-chunk type tag, so we recover a
//! best-guess kind from content. The `LcOpCommonSchemas`/registry chunk lists
//! the operator names that *produced* the chunks (e.g. `LcOpNwdGeometry`,
//! `LcOpNwdLogicalHierarchy`); content sniffing tells us which inflated chunk
//! is which. This is recon scaffolding, refined as each stream is decoded.

use crate::container::Container;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkKind {
    /// Many float32 vertex triples in a tight local range, u32 header.
    Geometry,
    /// Logical scene graph: `/path` names + class strings (`Group`, `lcldrvm_*`).
    LogicalHierarchy,
    /// f64-heavy: transforms / bounding boxes (spatial graph or fragments).
    SpatialOrFragments,
    /// The operator/schema name registry (`LcOp*` strings).
    SchemaRegistry,
    /// JSON payload (`{...}`), e.g. the XRef table.
    Json,
    /// Mostly printable text (paths, log lines, light names).
    Text,
    /// Unclassified.
    Unknown,
}

pub struct ChunkInfo {
    pub index: usize,
    pub offset: usize,
    pub compressed_len: usize,
    pub inflated_len: usize,
    pub kind: ChunkKind,
    /// A few representative strings extracted from the chunk.
    pub strings: Vec<String>,
    /// Source loaders named by the chunk's plugin slots (see [`loaders`]).
    pub loaders: Loaders,
}

/// Which source loaders a chunk (or, merged over its chunks, a file) names in
/// its plugin slots — see [`loaders`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Loaders {
    /// A Revit plugin: the file reader `LcNwcLoaderPlugin:lcldrevit` or the
    /// NWC exporter add-in `nwexportrevit`.
    pub revit: bool,
    /// Any other plugin (`LcNwcLoaderPlugin:lcldrvm`, a DWG / 3DS reader,
    /// another exporter …).
    pub other: bool,
}

impl Loaders {
    pub fn merge(self, o: Loaders) -> Loaders {
        Loaders {
            revit: self.revit || o.revit,
            other: self.other || o.other,
        }
    }

    /// The file names a Revit plugin and no other one: all of its geometry
    /// came through the Revit loader (stored in feet).
    pub fn revit_only(self) -> bool {
        self.revit && !self.other
    }
}

/// The plugin slots of a chunk: `[len u32][ASCII name, NUL-padded to 4]`,
/// 4-byte aligned, the name being either `LcNwcLoaderPlugin:<reader>` (a
/// Navisworks file reader: `lcldrvm`, `lcldrevit`, …) or `nwexport<tool>`
/// (the NWC exporter add-in that ran inside the authoring tool:
/// `nwexportrevit`). Every File node's trailer carries one, in front of the
/// source path — in the `LcOaPartition` metadata chunk and, for the File
/// nodes of a multi-file model, in the hierarchy chunk — and an exported
/// NWC's first chunk repeats it in front of the export options (whose keys,
/// `nwexportrevit_…` / `lcldrevit_…:n`, are not plugin names and are skipped).
///
/// On the sample corpus: 80 trailers of the three Huldra NWDs say `lcldrvm`;
/// the six public Revit files say `lcldrevit` (five) or `nwexportrevit`
/// (`Structural.nwc`). No allocation; one pass over the chunk's words.
pub fn loaders(data: &[u8]) -> Loaders {
    const READER: &[u8] = b"LcNwcLoaderPlugin:";
    const EXPORTER: &[u8] = b"nwexport";
    const REVIT_READER: &[u8] = b"lcldrevit";
    const REVIT_EXPORTER: &[u8] = b"revit";
    const MAX_NAME: usize = 96;
    let ident = |s: &[u8], extra: &[u8]| {
        !s.is_empty()
            && s.iter()
                .all(|b| b.is_ascii_alphanumeric() || extra.contains(b))
    };
    let mut found = Loaders::default();
    let mut o = 0usize;
    while o + 8 <= data.len() {
        let len = u32::from_le_bytes(data[o..o + 4].try_into().unwrap()) as usize;
        o += 4;
        if !(EXPORTER.len() < len && len <= MAX_NAME) {
            continue;
        }
        let Some(s) = data.get(o..o + len) else {
            continue;
        };
        let revit = match (s.strip_prefix(READER), s.strip_prefix(EXPORTER)) {
            (Some(n), _) if ident(n, b"_") => n == REVIT_READER,
            (None, Some(n)) if ident(n, b"") => n == REVIT_EXPORTER,
            _ => continue,
        };
        if revit {
            found.revit = true;
        } else {
            found.other = true;
        }
    }
    found
}

/// Fraction of bytes that are printable ASCII.
fn printable_ratio(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let p = data
        .iter()
        .filter(|&&b| (0x20..0x7f).contains(&b) || b == b'\n' || b == b'\t')
        .count();
    p as f64 / data.len() as f64
}

/// Fraction of 4-byte windows that parse as a "plausible model" float32
/// (finite, |x| in [1e-4, 1e6] or exactly 0).
fn float_ratio(data: &[u8]) -> f64 {
    if data.len() < 16 {
        return 0.0;
    }
    let n = data.len() / 4;
    let mut good = 0usize;
    for i in 0..n {
        let f = f32::from_le_bytes([
            data[i * 4],
            data[i * 4 + 1],
            data[i * 4 + 2],
            data[i * 4 + 3],
        ]);
        if f == 0.0 || (f.is_finite() && (1e-4..1e6).contains(&f.abs())) {
            good += 1;
        }
    }
    good as f64 / n as f64
}

/// Fraction of 8-byte windows that parse as a finite f64 "world coordinate"
/// (|x| in [10, 1e6]) — distinctive of the spatial/fragment transform stream.
fn f64_world_ratio(data: &[u8]) -> f64 {
    if data.len() < 32 {
        return 0.0;
    }
    let n = (data.len() - 8) / 4; // 4-byte-aligned starts
    let mut good = 0usize;
    for i in 0..n {
        let o = i * 4;
        let v = f64::from_le_bytes(data[o..o + 8].try_into().unwrap());
        if v.is_finite() && (10.0..=1.0e6).contains(&v.abs()) {
            good += 1;
        }
    }
    good as f64 / n as f64
}

/// Extract NUL/control-delimited printable runs of length ≥ `min_len`.
pub fn extract_strings(data: &[u8], min_len: usize, max_out: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = Vec::new();
    for &b in data {
        if (0x20..0x7f).contains(&b) {
            cur.push(b);
        } else {
            if cur.len() >= min_len {
                out.push(String::from_utf8_lossy(&cur).into_owned());
                if out.len() >= max_out {
                    return out;
                }
            }
            cur.clear();
        }
    }
    if cur.len() >= min_len && out.len() < max_out {
        out.push(String::from_utf8_lossy(&cur).into_owned());
    }
    out
}

/// Structural test for a LogicalHierarchy chunk: header
/// `[n][n × u32][first_id][root_count]` followed by the first node record
/// `[first_id + 1][22 | 53 | 32]…` (leaf name / container name / File node).
/// Catches hierarchies whose strings don't say `lcldrvm_container` — e.g. a
/// multi-file NWD holding only File nodes, whose five `LcOaPartition` class
/// strings used to make it look like the schema registry.
pub fn looks_like_hierarchy(data: &[u8]) -> bool {
    let rd = |o: usize| -> Option<u32> {
        data.get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let Some(n) = rd(0).map(|n| n as usize) else {
        return false;
    };
    if n > 100_000 {
        return false;
    }
    let h = 4 + 4 * n;
    match (rd(h), rd(h + 4), rd(h + 8), rd(h + 12)) {
        (Some(first), Some(roots), Some(id), Some(t)) => {
            (1..=10_000).contains(&first)
                && (1..1_000_000).contains(&roots)
                && id == first + 1
                && matches!(t, 22 | 53 | 32)
        }
        _ => false,
    }
}

fn classify(data: &[u8], strings: &[String]) -> ChunkKind {
    let joined = strings.join("\n");
    if data.starts_with(b"{") || data.iter().take(8).any(|&b| b == b'{') && joined.contains("\":") {
        return ChunkKind::Json;
    }
    // Structural detection, restricted to the RVM-loader family (whose node
    // grammar is decoded). Non-RVM hierarchies (DWG/3DS/Revit loaders) also
    // match the header shape, but their node grammar is not ported yet and a
    // partial tree would mislead the linker — they stay undetected for now.
    let rvm_family = joined.contains("lcldrvm_")
        || (joined.contains("LcOaPartition") && joined.to_ascii_lowercase().contains(".rvm"));
    if looks_like_hierarchy(data) && rvm_family {
        return ChunkKind::LogicalHierarchy;
    }
    // The registry lists many LcOp* operator names.
    let lcop = strings
        .iter()
        .filter(|s| s.contains("LcOp") || s.contains("LcOa"))
        .count();
    if lcop >= 5 {
        return ChunkKind::SchemaRegistry;
    }
    // Logical hierarchy: the group/container class `lcldrvm_container` is
    // distinctive to it. (The file-info chunk also carries `/`-paths and other
    // `lcldrvm_*` *property* class names — file_comments, banner, date — so
    // neither a path count nor a bare `lcldrvm_` prefix tells them apart.)
    // TODO: generalise beyond RVM-sourced NWDs (non-RVM class names differ).
    if joined.contains("lcldrvm_container") {
        return ChunkKind::LogicalHierarchy;
    }
    let fr = float_ratio(data);
    let pr = printable_ratio(data);
    // Spatial/fragment streams carry many f64 *world* translations (coords in
    // the tens..hundreds-of-thousands). Geometry uses only small f32 locals, so
    // a high f64-world density distinguishes the two — check it first.
    if data.len() > 4096 && f64_world_ratio(data) > 0.02 {
        return ChunkKind::SpatialOrFragments;
    }
    if fr > 0.6 {
        return ChunkKind::Geometry;
    }
    if pr > 0.6 {
        return ChunkKind::Text;
    }
    ChunkKind::Unknown
}

/// Classify every chunk in a container.
pub fn classify_all(c: &Container) -> Vec<ChunkInfo> {
    classify_except(c, &[])
}

/// [`classify_all`], but the chunks listed in `geometry` (sorted indices —
/// the geometry chain pinned by [`geometry_chunks_by_index`]) are labelled
/// `Geometry` WITHOUT being inflated or sniffed: they are the byte bulk of a
/// model and their kind is already known exactly. The rest are classified in
/// parallel (each chunk is inflated, sniffed and dropped on its worker).
pub fn classify_except(c: &Container, geometry: &[usize]) -> Vec<ChunkInfo> {
    let one = |index: usize| -> ChunkInfo {
        let ch = &c.chunks[index];
        let (kind, strings, loaders) = if geometry.binary_search(&index).is_ok() {
            (ChunkKind::Geometry, Vec::new(), Loaders::default())
        } else {
            let data = c.data(index);
            let strings = extract_strings(&data, 4, 32);
            (classify(&data, &strings), strings, loaders(&data))
        };
        ChunkInfo {
            index,
            offset: ch.offset,
            compressed_len: ch.compressed_len,
            inflated_len: ch.inflated_len,
            kind,
            strings,
            loaders,
        }
    };
    #[cfg(not(target_arch = "wasm32"))]
    {
        use rayon::prelude::*;
        (0..c.chunks.len()).into_par_iter().map(one).collect()
    }
    #[cfg(target_arch = "wasm32")]
    {
        (0..c.chunks.len()).map(one).collect()
    }
}

/// Locate the GEOMETRY chunks authoritatively via the geometry SIZE-INDEX
/// chunk: a small chunk laid out `[record_count][nchunks][nchunks × COMPRESSED
/// chunk sizes][record_count × inflated record sizes]` that immediately FOLLOWS
/// the geometry chunk chain. Its compressed-size list is matched against the
/// container's actual chunk sizes, which pins the geometry chunks exactly —
/// robust across writers (RVM/DWG/LightWorks; content heuristics are not).
/// Returns the geometry chunk indices (in order) plus the per-record inflated
/// sizes from the index. `None` = no index found (caller falls back to the
/// `ChunkKind::Geometry` heuristic).
pub fn geometry_chunks_by_index(c: &Container) -> Option<(Vec<usize>, Vec<u32>)> {
    let rd = |d: &[u8], o: usize| -> Option<u32> {
        d.get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    for (ci, ch) in c.chunks.iter().enumerate() {
        if ch.inflated_len < 16 {
            continue;
        }
        // Sniff the two header words first (inflating 8 bytes, not the
        // chunk): nearly every chunk is rejected here.
        let h = c.head(ci, 8);
        let (Some(count), Some(nchunks)) = (rd(&h, 0), rd(&h, 4)) else {
            continue;
        };
        let (count, nchunks) = (count as usize, nchunks as usize);
        // No fixed caps on the counts: a 170 MB plant model has ~4 700
        // geometry chunks and well over a million records. The checks below
        // (exact compressed sizes of the preceding chunks, record sizes
        // summing to their inflated total) are what make a match certain.
        if count == 0 || nchunks == 0 || nchunks > ci {
            continue;
        }
        if (ch.inflated_len as u64) < 8 + 4 * nchunks as u64 + 4 * count as u64 {
            continue;
        }
        let d = &c.data(ci);
        if d.len() < 8 + 4 * nchunks + 4 * count {
            continue;
        }
        // The nchunks entries must equal the compressed sizes of the chunks
        // immediately preceding this one, in order. Two writer conventions:
        // the zlib-consumed byte count (RVM back-to-back layout), or the
        // ON-DISK span to the next chunk (lichunk-007, which counts the
        // inter-chunk metadata bytes too).
        let start = ci - nchunks;
        let ok = (0..nchunks).all(|k| {
            let want = rd(d, 8 + 4 * k).map(|v| v as usize);
            let consumed = c.chunks[start + k].compressed_len;
            let span = c.chunks[start + k + 1].offset - c.chunks[start + k].offset;
            want == Some(consumed) || want == Some(span)
        });
        if !ok {
            continue;
        }
        // Record sizes must sum to the total inflated geometry bytes.
        let total: u64 = (0..count)
            .filter_map(|k| rd(d, 8 + 4 * nchunks + 4 * k).map(|v| v as u64))
            .sum();
        let inflated: u64 = (start..ci).map(|k| c.chunks[k].inflated_len as u64).sum();
        if total != inflated {
            continue;
        }
        let sizes: Vec<u32> = (0..count)
            .filter_map(|k| rd(d, 8 + 4 * nchunks + 4 * k))
            .collect();
        return Some(((start..ci).collect(), sizes));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{loaders, Loaders};

    /// `[len][name, NUL-padded to 4]` behind `lead` bytes of other data.
    fn slot(lead: usize, name: &str) -> Vec<u8> {
        let mut v = vec![0u8; lead];
        v.extend_from_slice(&(name.len() as u32).to_le_bytes());
        v.extend_from_slice(name.as_bytes());
        v.resize(v.len().div_ceil(4) * 4 + 12, 0);
        v
    }

    #[test]
    fn plugin_slots_name_the_loader() {
        let revit = Loaders {
            revit: true,
            other: false,
        };
        let other = Loaders {
            revit: false,
            other: true,
        };
        assert_eq!(loaders(&slot(8, "LcNwcLoaderPlugin:lcldrevit")), revit);
        assert_eq!(loaders(&slot(72, "nwexportrevit")), revit);
        assert_eq!(loaders(&slot(8, "LcNwcLoaderPlugin:lcldrvm")), other);
        assert_eq!(loaders(&slot(8, "LcNwcLoaderPlugin:lcldwg")), other);
        assert!(revit.revit_only() && !other.revit_only());
        assert!(!revit.merge(other).revit_only());
        // Not plugin slots: export-option keys, a wrong length word, an
        // unaligned string, a truncated chunk, nothing at all.
        let none = Loaders::default();
        assert_eq!(loaders(&slot(8, "nwexportrevit_element_params")), none);
        assert_eq!(loaders(&slot(8, "lcldrevit_extract_section:0")), none);
        assert_eq!(loaders(&slot(6, "LcNwcLoaderPlugin:lcldrevit")), none);
        let mut bad = slot(8, "LcNwcLoaderPlugin:lcldrevit");
        bad[8] += 1;
        assert_eq!(loaders(&bad), none);
        let cut = slot(8, "LcNwcLoaderPlugin:lcldrevit");
        assert_eq!(loaders(&cut[..20]), none);
        assert_eq!(loaders(&[]), none);
        assert_eq!(loaders(&[0xff; 7]), none);
        assert!(!none.revit_only());
    }
}
