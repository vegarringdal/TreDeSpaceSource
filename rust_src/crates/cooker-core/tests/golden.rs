//! Golden pipeline test: convert a real Huldra RVM sample (Equinor open data)
//! through rvm2glb (merged mode, as the app's Import Manager does), then cook
//! every produced GLB and validate the CADM output. The old byte-compare
//! against vulkan_reference/ went away with that folder; this exercises the
//! full RVM → GLB → .tdp pipeline instead.

use cad_format::ModelFileHeader;

/// HA-STRU.RVM → merged GLBs via rvm2glb with the app's defaults (merged mode,
/// no meshopt feature — the wasm shell the viewer ships builds the same way).
fn huldra_glbs() -> Option<Vec<(String, Vec<u8>)>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let rvm_path = root.join("../convertSamples/rvm/HA-STRU.RVM");
    if !rvm_path.exists() {
        eprintln!("sample missing — skipping");
        return None;
    }
    let rvm = std::fs::read(&rvm_path).unwrap();
    let mut sink = rvm_core::MemSink::new();
    let opts = rvm_core::ConvertOptions {
        source_name: "HA-STRU.RVM".into(),
        ..Default::default()
    };
    let report = rvm_core::convert(Box::new(rvm), &mut sink, &opts, &mut |_p| {}).expect("convert");
    let glbs: Vec<(String, Vec<u8>)> = sink
        .into_files()
        .into_iter()
        .filter(|(name, _)| name.ends_with(".glb"))
        .collect();
    eprintln!(
        "rvm2glb: {} output file(s), {} site GLB(s)",
        report.filemeta.len(),
        glbs.len()
    );
    assert!(!glbs.is_empty(), "HA-STRU.RVM produced no GLB sites");
    Some(glbs)
}

/// Default cook (v8): every site GLB cooks into a valid CADM file whose dense
/// bounds sit inside the full bounds.
#[test]
fn rvm_to_glb_to_cook() {
    let Some(glbs) = huldra_glbs() else { return };
    for (name, glb) in &glbs {
        let out = cooker_core::cook(glb, cooker_core::CookOptions::default())
            .unwrap_or_else(|e| panic!("cook {name}: {e}"));
        let b = &out.bytes;
        let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        let f32_at = |o: usize| f32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        assert_eq!(u32_at(0), 0x4d44_4143, "{name}: CADM magic");
        assert_eq!(u32_at(4), 9, "{name}: format version");
        assert!(u32_at(8) > 0, "{name}: no color groups");
        assert!(!out.root_name.is_empty(), "{name}: empty root name");
        for k in 0..3 {
            let (fmin, fmax) = (f32_at(48 + k * 4), f32_at(60 + k * 4));
            let (dmin, dmax) = (f32_at(216 + k * 4), f32_at(228 + k * 4));
            assert!(fmin < fmax, "{name} axis {k}: degenerate full bounds");
            assert!(
                dmin >= fmin && dmax <= fmax && dmin < dmax,
                "{name} axis {k}: dense outside full"
            );
        }
        let h: &ModelFileHeader =
            bytemuck::from_bytes(&b[..std::mem::size_of::<ModelFileHeader>()]);
        eprintln!(
            "{name}: {} B, cgs {}, root {:?}",
            b.len(),
            h.color_group_count,
            out.root_name
        );
    }
}

/// v7 (reference-compatible options): same pipeline, header stays 216 bytes
/// with version 7 — what the byte-compare against the native cooker used.
#[test]
fn rvm_to_glb_to_cook_v7() {
    let Some(glbs) = huldra_glbs() else { return };
    let (name, glb) = &glbs[0];
    let out = cooker_core::cook(
        glb,
        cooker_core::CookOptions {
            compute_normals: true,
            dense_bounds: false,
            coarsen: None,
            spatial_order: false, // v7 parity: plain id order
        },
    )
    .unwrap_or_else(|e| panic!("cook {name}: {e}"));
    let u32_at = |o: usize| u32::from_le_bytes(out.bytes[o..o + 4].try_into().unwrap());
    assert_eq!(u32_at(0), 0x4d44_4143, "CADM magic");
    assert_eq!(u32_at(4), 7, "format version");
    assert!(u32_at(8) > 0, "no color groups");
    eprintln!("v7 OK: {name} → {} B", out.bytes.len());
}

/// Spatial ordering (v9-RANGES phase 1) permutes only the DENSE packing
/// order. The semantic mapping the whole app relies on — source id → (colour
/// group, draw range) — must come out identical, because selection, hide
/// state, colour rules and the hierarchy are all keyed through it. This is
/// what makes renumbering safe; if it ever breaks, colours land on the wrong
/// items.
#[test]
fn spatial_order_permutes_only_the_packing() {
    use cad_format::{HierarchySectionHeader, ItemsSectionHeader};

    /// For every source id, the id of the DRAW RANGE its dense item points at.
    /// These must be equal: that link is what makes selection/colour/hide land
    /// on the right geometry. (The raw cg/dr indices are internal and DO change
    /// under spatial ordering — asserting on them would test the implementation,
    /// not the contract.) Also returns the dense order as a list of source ids.
    fn id_to_drawrange_id(b: &[u8]) -> (std::collections::HashMap<u32, u32>, Vec<u32>) {
        use cad_format::{HierarchySectionHeader, ItemsSectionHeader};
        let version = u32::from_le_bytes(b[4..8].try_into().unwrap());
        let cg_start: usize = match version {
            7 => 216,
            8 => 240,
            _ => 256,
        };
        let cg_count = u32::from_le_bytes(b[8..12].try_into().unwrap()) as usize;
        // per colour group: the draw-range id array
        let dr_ids: Vec<Vec<u32>> = (0..cg_count)
            .map(|i| {
                let base = cg_start + i * 128;
                let d = u32::from_le_bytes(b[base + 24..base + 28].try_into().unwrap()) as usize;
                let off = u64::from_ne_bytes(b[base + 32..base + 40].try_into().unwrap()) as usize;
                (0..d)
                    .map(|k| {
                        u32::from_le_bytes(b[off + k * 4..off + k * 4 + 4].try_into().unwrap())
                    })
                    .collect()
            })
            .collect();

        let h: ModelFileHeader =
            bytemuck::pod_read_unaligned(&b[..std::mem::size_of::<ModelFileHeader>()]);
        let ish: ItemsSectionHeader = bytemuck::pod_read_unaligned(
            &b[h.items_offset as usize
                ..h.items_offset as usize + std::mem::size_of::<ItemsSectionHeader>()],
        );
        let hsh: HierarchySectionHeader = bytemuck::pod_read_unaligned(
            &b[h.hierarchy_offset as usize
                ..h.hierarchy_offset as usize + std::mem::size_of::<HierarchySectionHeader>()],
        );
        let cg_off = ish.item_to_color_group_offset as usize;
        let dr_off = ish.item_to_draw_range_idx_offset as usize;
        let mut map = std::collections::HashMap::new();
        let mut order = vec![u32::MAX; ish.item_count as usize];
        for k in 0..hsh.id_item_count as usize {
            let e = hsh.id_item_offset as usize + k * 8;
            let id = u32::from_le_bytes(b[e..e + 4].try_into().unwrap());
            let item = u32::from_le_bytes(b[e + 4..e + 8].try_into().unwrap()) as usize;
            let cg = u16::from_le_bytes(
                b[cg_off + item * 2..cg_off + item * 2 + 2]
                    .try_into()
                    .unwrap(),
            ) as usize;
            let dr = u32::from_le_bytes(
                b[dr_off + item * 4..dr_off + item * 4 + 4]
                    .try_into()
                    .unwrap(),
            ) as usize;
            map.insert(id, dr_ids[cg][dr]);
            order[item] = id;
        }
        (map, order)
    }

    let Some(glbs) = huldra_glbs() else { return };
    let (name, glb) = &glbs[0];
    let plain = cooker_core::cook(
        glb,
        cooker_core::CookOptions {
            spatial_order: false,
            ..Default::default()
        },
    )
    .unwrap_or_else(|e| panic!("plain cook {name}: {e}"));
    let spatial = cooker_core::cook(glb, cooker_core::CookOptions::default())
        .unwrap_or_else(|e| panic!("spatial cook {name}: {e}"));

    let (map_a, order_a) = id_to_drawrange_id(&plain.bytes);
    let (map_b, order_b) = id_to_drawrange_id(&spatial.bytes);
    assert_eq!(map_a.len(), map_b.len(), "{name}: item count changed");
    // every item points at its OWN draw range, in both cooks
    for (map, which) in [(&map_a, "plain"), (&map_b, "spatial")] {
        for (id, dr_id) in map.iter() {
            assert_eq!(
                id, dr_id,
                "{name} ({which}): item {id} points at draw range {dr_id}"
            );
        }
    }
    assert_eq!(
        map_a, map_b,
        "{name}: id → draw-range-id mapping must be identical"
    );
    assert_ne!(
        order_a, order_b,
        "{name}: spatial order did not actually reorder anything"
    );
    let mut sorted_a = order_a.clone();
    let mut sorted_b = order_b.clone();
    sorted_a.sort_unstable();
    sorted_b.sort_unstable();
    assert_eq!(
        sorted_a, sorted_b,
        "{name}: the id set must be a pure permutation"
    );
    eprintln!(
        "{name}: {} items reordered spatially, mapping intact",
        order_b.len()
    );
}

/// v9 cell table: the ranges ARE the octree, so they must tile the item space
/// exactly — every item in exactly one cell, each cell contiguous, no gaps and
/// no overlaps. If this ever breaks, range-based loading would silently drop
/// or duplicate geometry.
#[test]
fn v9_cell_table_tiles_every_item() {
    use cad_format::{CellEntry, ItemsSectionHeader, CELL_COUNT};

    let Some(glbs) = huldra_glbs() else { return };
    for (name, glb) in &glbs {
        let out = cooker_core::cook(glb, cooker_core::CookOptions::default())
            .unwrap_or_else(|e| panic!("cook {name}: {e}"));
        let b = &out.bytes;
        assert_eq!(
            u32::from_le_bytes(b[4..8].try_into().unwrap()),
            9,
            "{name}: expected FORMAT v9"
        );
        let cell_off = u64::from_ne_bytes(b[240..248].try_into().unwrap()) as usize;
        let cell_count = u32::from_ne_bytes(b[248..252].try_into().unwrap());
        assert_eq!(cell_count, CELL_COUNT, "{name}: cell count");

        let h: ModelFileHeader =
            bytemuck::pod_read_unaligned(&b[..std::mem::size_of::<ModelFileHeader>()]);
        let ish: ItemsSectionHeader = bytemuck::pod_read_unaligned(
            &b[h.items_offset as usize
                ..h.items_offset as usize + std::mem::size_of::<ItemsSectionHeader>()],
        );

        let mut cells: Vec<CellEntry> = Vec::with_capacity(cell_count as usize);
        for i in 0..cell_count as usize {
            cells.push(bytemuck::pod_read_unaligned(
                &b[cell_off + i * 32..cell_off + i * 32 + 32],
            ));
        }

        // every item covered exactly once, and each cell's range is contiguous
        let mut seen = vec![0u8; ish.item_count as usize];
        let mut occupied = 0usize;
        for (ci, c) in cells.iter().enumerate() {
            if c.item_count == 0 {
                continue;
            }
            occupied += 1;
            let s = c.item_start as usize;
            let e = s + c.item_count as usize;
            assert!(
                e <= seen.len(),
                "{name}: cell {ci} range past the item table"
            );
            for slot in &mut seen[s..e] {
                assert_eq!(*slot, 0, "{name}: cell {ci} overlaps another cell");
                *slot = 1;
            }
            for k in 0..3 {
                assert!(
                    c.aabb_min[k] <= c.aabb_max[k],
                    "{name}: cell {ci} has a degenerate AABB"
                );
            }
        }
        assert!(
            seen.iter().all(|&s| s == 1),
            "{name}: some items are in no cell"
        );
        assert!(
            occupied > 1,
            "{name}: everything landed in one cell — binning did nothing"
        );
        eprintln!(
            "{name}: {} items across {occupied} occupied cells",
            ish.item_count
        );
    }
}

/// Coarse variant (VRAM-budget residency swap): the item table and hierarchy
/// must match the full cook EXACTLY — item ids, order, item→cg/dr mappings,
/// names, id→item table — because the viewer swaps variants in place and keeps
/// per-item state keyed by dense item index. Only geometry may differ (and
/// must shrink). Section headers hold absolute file offsets, so the comparison
/// is on array CONTENTS, not raw section bytes.
#[test]
fn coarse_cook_preserves_item_table() {
    use cad_format::{HierarchySectionHeader, ItemsSectionHeader};

    struct Tables {
        item_to_cg: Vec<u8>,
        item_to_dr: Vec<u8>,
        name_pool: Vec<u8>,
        entries: Vec<u8>,
        id_item: Vec<u8>,
        item_count: u32,
    }
    fn tables(b: &[u8]) -> Tables {
        let h: ModelFileHeader =
            bytemuck::pod_read_unaligned(&b[..std::mem::size_of::<ModelFileHeader>()]);
        let ish: ItemsSectionHeader = bytemuck::pod_read_unaligned(
            &b[h.items_offset as usize
                ..h.items_offset as usize + std::mem::size_of::<ItemsSectionHeader>()],
        );
        let hsh: HierarchySectionHeader = bytemuck::pod_read_unaligned(
            &b[h.hierarchy_offset as usize
                ..h.hierarchy_offset as usize + std::mem::size_of::<HierarchySectionHeader>()],
        );
        let n = ish.item_count as usize;
        let slice = |off: u64, len: usize| b[off as usize..off as usize + len].to_vec();
        Tables {
            item_to_cg: slice(ish.item_to_color_group_offset, n * 2),
            item_to_dr: slice(ish.item_to_draw_range_idx_offset, n * 4),
            name_pool: slice(hsh.name_pool_offset, hsh.name_pool_len as usize),
            entries: slice(hsh.entries_offset, hsh.entry_count as usize * 16),
            id_item: slice(hsh.id_item_offset, hsh.id_item_count as usize * 8),
            item_count: ish.item_count,
        }
    }

    let Some(glbs) = huldra_glbs() else { return };
    let mut full_total = 0usize;
    let mut coarse_total = 0usize;
    for (name, glb) in &glbs {
        let full = cooker_core::cook(glb, cooker_core::CookOptions::default())
            .unwrap_or_else(|e| panic!("full cook {name}: {e}"));
        let coarse = cooker_core::cook(
            glb,
            cooker_core::CookOptions {
                coarsen: Some(cooker_core::CoarsenOptions::default()),
                ..Default::default()
            },
        )
        .unwrap_or_else(|e| panic!("coarse cook {name}: {e}"));

        let tf = tables(&full.bytes);
        let tc = tables(&coarse.bytes);
        assert_eq!(tf.item_count, tc.item_count, "{name}: item count");
        assert_eq!(tf.item_to_cg, tc.item_to_cg, "{name}: item→cg");
        assert_eq!(tf.item_to_dr, tc.item_to_dr, "{name}: item→dr");
        assert_eq!(tf.name_pool, tc.name_pool, "{name}: name pool");
        assert_eq!(tf.entries, tc.entries, "{name}: hierarchy entries");
        assert_eq!(tf.id_item, tc.id_item, "{name}: id→item table");
        assert_eq!(full.root_name, coarse.root_name, "{name}: root name");
        assert!(
            coarse.bytes.len() < full.bytes.len(),
            "{name}: coarse ({} B) not smaller than full ({} B)",
            coarse.bytes.len(),
            full.bytes.len()
        );
        full_total += full.bytes.len();
        coarse_total += coarse.bytes.len();
    }
    eprintln!(
        "coarse/full size: {coarse_total}/{full_total} B ({:.1}%)",
        100.0 * coarse_total as f64 / full_total as f64
    );
}
