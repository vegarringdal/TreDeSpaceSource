//! Public conversion entry point: `convert(ifc_bytes, opts) -> ConvertOutput`.
//!
//! Runs the IFC front end ([`process_geometry_streaming_with_options_and_bootstrap`]) to
//! get world-space meshes + the spatial tree, groups meshes into output files by spatial
//! tier ([`SplitTier`]), writes each group as a GLB in the chosen [`OutputMode`], and emits
//! a `status_file.json` manifest.

use std::collections::HashMap;

use ifc_lite_processing::{
    MeshData, ProcessingResult, QuickMetadataBootstrap, QuickMetadataSpatialNode, StreamingOptions,
    TessellationQuality, process_geometry_streaming_with_options_and_bootstrap,
};

use crate::glb::{self, HierNode};
use crate::mesh::{Instance, Mesh};
use crate::split::{self, Group, SplitTier};
use crate::status::{self, FileMeta};

/// GLB output layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutputMode {
    /// One mesh per unique colour; per-element identity in scene `extras`. Smallest.
    #[default]
    Merged,
    /// Native glTF node tree, one mesh per element, no merge.
    Standard,
    /// Shared meshes: each repeated shape triangulated once, a node per occurrence
    /// referencing it with its own `matrix`.
    Instanced,
    /// Shared meshes collapsed to one node per shape via `EXT_mesh_gpu_instancing`
    /// (per-instance TRS). Fewest nodes; needs viewer support for the extension.
    GpuInstanced,
}

impl OutputMode {
    pub fn as_str(self) -> &'static str {
        match self {
            OutputMode::Merged => "merged",
            OutputMode::Standard => "standard",
            OutputMode::Instanced => "instanced",
            OutputMode::GpuInstanced => "gpu-instanced",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "merged" => Some(OutputMode::Merged),
            "standard" => Some(OutputMode::Standard),
            "instanced" => Some(OutputMode::Instanced),
            "gpu-instanced" | "gpu_instanced" | "gpuinstanced" => Some(OutputMode::GpuInstanced),
            _ => None,
        }
    }
    fn is_instanced(self) -> bool {
        matches!(self, OutputMode::Instanced | OutputMode::GpuInstanced)
    }
}

/// How to handle `IfcSpace` room-volume geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Spaces {
    /// Drop spaces entirely (they overlap the real geometry).
    #[default]
    Skip,
    /// Render spaces alongside the physical model.
    Include,
    /// Export spaces to their own separate GLB file(s) (`*_spaces.glb`).
    Separate,
}

impl Spaces {
    pub fn as_str(self) -> &'static str {
        match self {
            Spaces::Skip => "skip",
            Spaces::Include => "include",
            Spaces::Separate => "separate",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "skip" | "none" => Some(Spaces::Skip),
            "include" => Some(Spaces::Include),
            "separate" | "own" => Some(Spaces::Separate),
            _ => None,
        }
    }
}

/// How to handle `IfcOpeningElement` void geometry (the boxes cut out of walls).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Openings {
    /// Drop openings entirely (they are voids already cut into their host — the default).
    #[default]
    Skip,
    /// Render the opening void solids alongside the model (they will fill their holes).
    Include,
    /// Export the opening void solids to their own GLB file(s) (`*_openings.glb`).
    Separate,
}

impl Openings {
    pub fn as_str(self) -> &'static str {
        match self {
            Openings::Skip => "skip",
            Openings::Include => "include",
            Openings::Separate => "separate",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "skip" | "none" => Some(Openings::Skip),
            "include" => Some(Openings::Include),
            "separate" | "own" => Some(Openings::Separate),
            _ => None,
        }
    }
}

/// Tessellation detail level (maps to ifc-lite's `TessellationQuality`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Quality {
    Lowest,
    Low,
    #[default]
    Medium,
    High,
    Highest,
}

impl Quality {
    fn to_ifc(self) -> TessellationQuality {
        match self {
            Quality::Lowest => TessellationQuality::Lowest,
            Quality::Low => TessellationQuality::Low,
            Quality::Medium => TessellationQuality::Medium,
            Quality::High => TessellationQuality::High,
            Quality::Highest => TessellationQuality::Highest,
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "lowest" => Some(Quality::Lowest),
            "low" => Some(Quality::Low),
            "medium" | "default" => Some(Quality::Medium),
            "high" => Some(Quality::High),
            "highest" => Some(Quality::Highest),
            _ => None,
        }
    }
}

/// Conversion knobs (the CLI/UI flags, minus the I/O paths).
#[derive(Debug, Clone)]
pub struct ConvertOptions {
    pub mode: OutputMode,
    pub split: SplitTier,
    pub quality: Quality,
    /// How `IfcSpace` room volumes are handled.
    pub spaces: Spaces,
    /// How `IfcOpeningElement` void solids are handled.
    pub openings: Openings,
    /// Recentre the model on its bbox centre so world coordinates stay f32-precise.
    pub recenter: bool,
    /// Parse + build geometry but produce no GLB bytes.
    pub dry_run: bool,
    /// Recorded in `status_file.json` as the source name.
    pub source_name: String,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            mode: OutputMode::Merged,
            split: SplitTier::None,
            quality: Quality::Medium,
            spaces: Spaces::Skip,
            openings: Openings::Skip,
            recenter: true,
            dry_run: false,
            source_name: "model.ifc".to_string(),
        }
    }
}

/// One named output file produced by a conversion.
#[derive(Debug, Clone)]
pub struct OutputFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Summary of a conversion.
#[derive(Debug, Clone, Default)]
pub struct ConvertReport {
    pub mesh_count: usize,
    pub triangle_count: usize,
    pub file_count: usize,
    pub schema: Option<String>,
}

/// Everything a conversion yields: the output files (GLBs + `status_file.json`) + a report.
#[derive(Debug, Clone, Default)]
pub struct ConvertOutput {
    pub files: Vec<OutputFile>,
    pub report: ConvertReport,
}

/// Convert one IFC model (raw bytes) to GLB(s) + `status_file.json`.
pub fn convert(ifc_bytes: &[u8], opts: &ConvertOptions) -> Result<ConvertOutput, String> {
    convert_with_progress(ifc_bytes, opts, &mut |_| {})
}

/// Cook hook: turns one merged export (in memory, no GLB) plus its output stem
/// into the bytes to write. See [`convert_cooked`].
pub type CookHook<'a> = &'a dyn Fn(glb::MergedData, &str) -> Result<Vec<u8>, String>;

/// Like [`convert`], but merged mode emits cooked `.tdp` files: `cook` receives
/// each output's merged export in memory, so no GLB is built or parsed. The
/// cooker lives outside this crate, hence the callback.
pub fn convert_cooked(
    ifc_bytes: &[u8],
    opts: &ConvertOptions,
    cook: CookHook,
) -> Result<ConvertOutput, String> {
    convert_inner(ifc_bytes, opts, &mut |_| {}, Some(cook))
}

/// Like [`convert`] but reports progress in `0.0..=1.0` (geometry phase spans `0..0.9`,
/// GLB writing the last `0.1`). The demo uses this to drive a progress bar.
pub fn convert_with_progress(
    ifc_bytes: &[u8],
    opts: &ConvertOptions,
    progress: &mut dyn FnMut(f32),
) -> Result<ConvertOutput, String> {
    convert_inner(ifc_bytes, opts, progress, None)
}

fn convert_inner(
    ifc_bytes: &[u8],
    opts: &ConvertOptions,
    progress: &mut dyn FnMut(f32),
    cook: Option<CookHook>,
) -> Result<ConvertOutput, String> {
    // Front end: meshes + the spatial tree. The tree drives both the file split and the
    // node hierarchy that BOTH output modes emit (merged `id_hierarchy`, standard nesting),
    // so always request the lightweight bootstrap. A finite batch size lets `on_batch`
    // report progress while `result.meshes` is still fully populated at the end.
    let mut tree: Option<QuickMetadataSpatialNode> = None;
    let stream_opts = StreamingOptions {
        initial_batch_size: 256,
        throughput_batch_size: 1024,
        tessellation_quality: opts.quality.to_ifc(),
        emit_quick_metadata_bootstrap: true,
        enable_instancing: opts.mode.is_instanced(),
        ..StreamingOptions::default()
    };
    let result = process_geometry_streaming_with_options_and_bootstrap(
        ifc_bytes,
        stream_opts,
        |_batch, processed, total| {
            let frac = if total > 0 {
                0.9 * (processed as f32 / total as f32)
            } else {
                0.0
            };
            progress(frac);
        },
        |_| {},
        |b: &QuickMetadataBootstrap| {
            if tree.is_none() {
                tree = b.spatial_tree.clone();
            }
        },
    );
    progress(0.9);

    // Collect meshes, routing IfcSpace per `opts.spaces` and IfcOpeningElement per
    // `opts.openings`. IfcAnnotation is always dropped.
    let mut physical: Vec<Mesh> = Vec::new();
    let mut spaces: Vec<Mesh> = Vec::new();
    let mut openings: Vec<Mesh> = Vec::new();
    for m in result.meshes.iter().filter(|m| m.geometry_class == 0) {
        let ty = m.ifc_type.to_ascii_lowercase();
        if ty == "ifcannotation" {
            continue;
        } else if ty == "ifcopeningelement" {
            match opts.openings {
                Openings::Skip => continue,
                Openings::Include => {
                    if let Some(mesh) = to_mesh(m) {
                        physical.push(mesh);
                    }
                }
                Openings::Separate => {
                    if let Some(mesh) = to_mesh(m) {
                        openings.push(mesh);
                    }
                }
            }
        } else if ty == "ifcspace" {
            match opts.spaces {
                Spaces::Skip => continue,
                Spaces::Include => {
                    if let Some(mesh) = to_mesh(m) {
                        physical.push(mesh);
                    }
                }
                Spaces::Separate => {
                    if let Some(mesh) = to_mesh(m) {
                        spaces.push(mesh);
                    }
                }
            }
        } else if let Some(mesh) = to_mesh(m) {
            physical.push(mesh);
        }
    }

    let triangle_count: usize = physical
        .iter()
        .chain(spaces.iter())
        .chain(openings.iter())
        .map(|m| m.indices.len() / 3)
        .sum();
    let mesh_count = physical.len() + spaces.len() + openings.len();
    let schema = schema_of(&result);

    if opts.dry_run {
        return Ok(ConvertOutput {
            files: Vec::new(),
            report: ConvertReport {
                mesh_count,
                triangle_count,
                file_count: 0,
                schema,
            },
        });
    }

    // Recenter physical + spaces + openings together so they share one frame.
    let center = if opts.recenter {
        recenter_all(&mut [&mut physical, &mut spaces, &mut openings])
    } else {
        [0.0; 3]
    };

    let root_name = tree
        .as_ref()
        .map(|t| {
            let n = t.summary.name.trim();
            if n.is_empty() {
                "model".to_string()
            } else {
                n.to_string()
            }
        })
        .unwrap_or_else(|| "model".to_string());

    let mut files: Vec<OutputFile> = Vec::new();
    let mut metas: Vec<FileMeta> = Vec::new();
    let mut used_names: HashMap<String, u32> = HashMap::new();

    if opts.mode.is_instanced() {
        // Instanced modes flatten the tree, so `--split` doesn't apply (single file). The
        // templates are in `physical`; the extra occurrences come from `result.instances`.
        let instances: Vec<Instance> = result
            .instances
            .iter()
            .filter(|r| {
                let t = r.ifc_type.to_ascii_lowercase();
                t != "ifcopeningelement" && t != "ifcannotation" && t != "ifcspace"
            })
            .map(|r| Instance {
                express_id: r.express_id,
                ifc_type: r.ifc_type.clone(),
                name: r.name.clone(),
                template_express_id: r.template_express_id,
                transform: r.transform,
            })
            .collect();

        emit_instanced(
            &physical,
            &instances,
            center,
            opts,
            &root_name,
            "",
            &mut files,
            &mut metas,
            &mut used_names,
            cook,
        )?;
        if !spaces.is_empty() {
            // Spaces aren't instanced; emit them as identity-placed occurrences.
            emit_instanced(
                &spaces,
                &[],
                center,
                opts,
                &root_name,
                "_spaces",
                &mut files,
                &mut metas,
                &mut used_names,
                cook,
            )?;
        }
        if !openings.is_empty() {
            emit_instanced(
                &openings,
                &[],
                center,
                opts,
                &root_name,
                "_openings",
                &mut files,
                &mut metas,
                &mut used_names,
                cook,
            )?;
        }
    } else {
        emit_files(
            &physical,
            "",
            opts,
            tree.as_ref(),
            &root_name,
            ifc_bytes,
            &mut files,
            &mut metas,
            &mut used_names,
            cook,
        )?;
        if !spaces.is_empty() {
            emit_files(
                &spaces,
                "_spaces",
                opts,
                tree.as_ref(),
                &root_name,
                ifc_bytes,
                &mut files,
                &mut metas,
                &mut used_names,
                cook,
            )?;
        }
        if !openings.is_empty() {
            emit_files(
                &openings,
                "_openings",
                opts,
                tree.as_ref(),
                &root_name,
                ifc_bytes,
                &mut files,
                &mut metas,
                &mut used_names,
                cook,
            )?;
        }
    }

    // status_file.json.
    let status = status::build(
        &opts.source_name,
        schema.as_deref(),
        result.metadata.length_unit_scale,
        opts.mode.as_str(),
        split_label(opts.split),
        &metas,
        &result_warnings(&result),
    );
    files.push(OutputFile {
        name: "status_file.json".to_string(),
        bytes: status,
    });

    progress(1.0);
    let file_count = files.len();
    Ok(ConvertOutput {
        files,
        report: ConvertReport {
            mesh_count,
            triangle_count,
            file_count,
            schema,
        },
    })
}

/// Emit one instanced GLB (single file; instanced modes flatten the tree so `--split`
/// doesn't apply). `center` is the recentre offset folded into per-instance transforms.
#[allow(clippy::too_many_arguments)]
fn emit_instanced(
    templates: &[Mesh],
    instances: &[Instance],
    center: [f32; 3],
    opts: &ConvertOptions,
    root_name: &str,
    suffix: &str,
    files: &mut Vec<OutputFile>,
    metas: &mut Vec<FileMeta>,
    used_names: &mut HashMap<String, u32>,
    cook: Option<CookHook>,
) -> Result<(), String> {
    if templates.is_empty() {
        return Ok(());
    }
    let gpu = opts.mode == OutputMode::GpuInstanced;
    let bytes = glb::write_instanced(templates, instances, center, gpu)?;
    let (min, max) = group_bounds(templates);
    let tris: u32 = templates.iter().map(|m| (m.indices.len() / 3) as u32).sum();
    let stem = format!("{}{suffix}", split::file_stem(root_name));
    let name = unique_name(used_names, &stem, false);
    metas.push(FileMeta {
        file_name: name.clone(),
        root_name: root_name.to_string(),
        node_count: (templates.len() + instances.len()) as u32,
        triangle_count: tris,
        glb_bytes: bytes.len(),
        bbox_min: min,
        bbox_max: max,
    });
    files.push(OutputFile { name, bytes });
    Ok(())
}

/// Split `meshes` into per-tier GLB files and append them (+ their metadata). `suffix` is
/// added to each file stem (`""` for the physical model, `"_spaces"` for the spaces pass).
#[allow(clippy::too_many_arguments)]
fn emit_files(
    meshes: &[Mesh],
    suffix: &str,
    opts: &ConvertOptions,
    tree: Option<&QuickMetadataSpatialNode>,
    root_name: &str,
    ifc_bytes: &[u8],
    files: &mut Vec<OutputFile>,
    metas: &mut Vec<FileMeta>,
    used_names: &mut HashMap<String, u32>,
    cook: Option<CookHook>,
) -> Result<(), String> {
    if meshes.is_empty() {
        return Ok(());
    }
    let (assignment, default_group) = split::assign_groups(opts.split, tree, root_name);
    let buckets = bucket(meshes, &assignment, &default_group);
    let hierarchy = build_hierarchy(tree, meshes, ifc_bytes);

    for (group, idxs) in &buckets {
        let group_meshes: Vec<Mesh> = idxs.iter().map(|&i| meshes[i].clone()).collect();
        // Instanced modes route through `emit_instanced`, never here.
        let stem = format!("{}{suffix}", split::file_stem(&group.name));
        let bytes = match opts.mode {
            // Merged + cook hook: build the export in memory and cook it — no
            // GLB is assembled. Other modes ignore the hook (only the merged
            // shape carries the draw ranges the cooker needs).
            OutputMode::Merged if cook.is_some() => {
                let merged = glb::build_merged(&group_meshes, &hierarchy)?;
                (cook.unwrap())(merged, &stem)?
            }
            OutputMode::Merged => glb::write_merged(&group_meshes, &hierarchy)?,
            OutputMode::Standard | OutputMode::Instanced | OutputMode::GpuInstanced => {
                glb::write_standard(&group_meshes, &hierarchy)?
            }
        };
        let (min, max) = group_bounds(&group_meshes);
        let tris: u32 = group_meshes
            .iter()
            .map(|m| (m.indices.len() / 3) as u32)
            .sum();
        let name = unique_name(used_names, &stem, cook.is_some());
        metas.push(FileMeta {
            file_name: name.clone(),
            root_name: group.name.clone(),
            node_count: group_meshes.len() as u32,
            triangle_count: tris,
            glb_bytes: bytes.len(),
            bbox_min: min,
            bbox_max: max,
        });
        files.push(OutputFile { name, bytes });
    }
    Ok(())
}

/// Partition mesh indices into groups, preserving first-seen group order. Meshes with no
/// assignment fall into `default_group`.
fn bucket(
    meshes: &[Mesh],
    assignment: &HashMap<u32, Group>,
    default_group: &Group,
) -> Vec<(Group, Vec<usize>)> {
    let mut order: Vec<u32> = Vec::new();
    let mut by_node: HashMap<u32, (Group, Vec<usize>)> = HashMap::new();
    for (i, m) in meshes.iter().enumerate() {
        let g = assignment.get(&m.express_id).unwrap_or(default_group);
        by_node
            .entry(g.node_id)
            .or_insert_with(|| {
                order.push(g.node_id);
                (g.clone(), Vec::new())
            })
            .1
            .push(i);
    }
    order
        .into_iter()
        .map(|id| by_node.remove(&id).unwrap())
        .collect()
}

fn unique_name(used: &mut HashMap<String, u32>, stem: &str, cooked: bool) -> String {
    let ext = if cooked { "tdp" } else { "glb" };
    let n = used.entry(stem.to_string()).or_insert(0);
    *n += 1;
    if *n == 1 {
        format!("{stem}.{ext}")
    } else {
        format!("{stem}_{n}.{ext}")
    }
}

fn split_label(tier: SplitTier) -> &'static str {
    match tier {
        SplitTier::None => "none",
        SplitTier::Site => "site",
        SplitTier::Building => "building",
        SplitTier::Storey => "storey",
    }
}

/// Map one upstream `MeshData` into our [`Mesh`], folding the per-mesh f64 `origin` into
/// absolute world positions (`world = origin + position`).
fn to_mesh(m: &MeshData) -> Option<Mesh> {
    if m.positions.is_empty() || m.indices.is_empty() || !m.positions.len().is_multiple_of(3) {
        return None;
    }
    let [ox, oy, oz] = m.origin;
    let positions: Vec<f32> = m
        .positions
        .chunks_exact(3)
        .flat_map(|p| {
            [
                (p[0] as f64 + ox) as f32,
                (p[1] as f64 + oy) as f32,
                (p[2] as f64 + oz) as f32,
            ]
        })
        .collect();
    let normals = if m.normals.len() == m.positions.len() {
        m.normals.clone()
    } else {
        Vec::new()
    };
    // Carry UVs + texture only when consistent (1:1 with vertices, well-formed image).
    let vertex_count = m.positions.len() / 3;
    let uvs = m
        .uvs
        .as_ref()
        .filter(|u| u.len() == vertex_count * 2)
        .cloned();
    let texture = m.texture.as_ref().and_then(|t| {
        let ok = t.width > 0
            && t.height > 0
            && t.rgba.len() == (t.width as usize) * (t.height as usize) * 4;
        ok.then(|| crate::mesh::MeshTexture {
            rgba: t.rgba.clone(),
            width: t.width,
            height: t.height,
            repeat_s: t.repeat_s,
            repeat_t: t.repeat_t,
        })
    });
    Some(Mesh {
        express_id: m.express_id,
        ifc_type: m.ifc_type.clone(),
        name: m.name.clone(),
        positions,
        normals,
        indices: m.indices.clone(),
        color: m.color,
        uvs: uvs.filter(|_| texture.is_some()),
        texture,
    })
}

/// Subtract the overall bbox centre from every vertex across ALL sets (physical, spaces,
/// openings), so every output file shares one coordinate frame. Returns the centre
/// subtracted (`[0,0,0]` if there were no finite vertices) — the instanced writers need it
/// to keep per-instance transforms consistent with the recentred template geometry.
fn recenter_all(sets: &mut [&mut Vec<Mesh>]) -> [f32; 3] {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for set in sets.iter() {
        let (smin, smax) = all_bounds(set);
        for k in 0..3 {
            min[k] = min[k].min(smin[k]);
            max[k] = max[k].max(smax[k]);
        }
    }
    if !min[0].is_finite() {
        return [0.0; 3];
    }
    let c = [
        0.5 * (min[0] + max[0]),
        0.5 * (min[1] + max[1]),
        0.5 * (min[2] + max[2]),
    ];
    for set in sets.iter_mut() {
        for m in set.iter_mut() {
            for p in m.positions.chunks_exact_mut(3) {
                p[0] -= c[0];
                p[1] -= c[1];
                p[2] -= c[2];
            }
        }
    }
    c
}

fn all_bounds(meshes: &[Mesh]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for m in meshes {
        for p in m.positions.chunks_exact(3) {
            for k in 0..3 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
    }
    (min, max)
}

fn group_bounds(meshes: &[Mesh]) -> ([f32; 3], [f32; 3]) {
    let (min, max) = all_bounds(meshes);
    if min[0].is_finite() {
        (min, max)
    } else {
        ([0.0; 3], [0.0; 3])
    }
}

fn schema_of(result: &ProcessingResult) -> Option<String> {
    let s = &result.metadata.schema_version;
    if s.is_empty() { None } else { Some(s.clone()) }
}

/// Build the treeview hierarchy for merged output.
///
/// Two sources, in priority order:
/// 1. The IFC **spatial tree** (Project → Site → Building → Storey → contained elements).
/// 2. For meshes NOT directly contained (curtain-wall members, stair parts, openings,
///    doors/windows): the **element relationships** scanned from the STEP text —
///    `IfcRelAggregates`/`Nests` (part → whole), `IfcRelVoidsElement` (opening → host) and
///    `IfcRelFillsElement` (filler → opening) — chained upward until the chain reaches an
///    element already in the tree (so a door lands `door → opening → wall → storey`).
///    Intermediate ancestors get entries too (typed labels via a header scan).
///
/// Only meshes whose chain resolves nowhere fall back flat (`parent = None` ⇒ `"*"`).
fn build_hierarchy(
    tree: Option<&QuickMetadataSpatialNode>,
    meshes: &[Mesh],
    ifc_bytes: &[u8],
) -> Vec<HierNode> {
    use std::collections::{HashMap, HashSet};

    let mut out: Vec<HierNode> = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();
    if let Some(t) = tree {
        walk_hierarchy(t, None, &mut out, &mut seen);
    }

    let orphan: Vec<&Mesh> = meshes
        .iter()
        .filter(|m| !seen.contains(&m.express_id))
        .collect();
    if orphan.is_empty() {
        return out;
    }

    let links = crate::relations::parse_parent_links(ifc_bytes);
    let mesh_label: HashMap<u32, String> =
        meshes.iter().map(|m| (m.express_id, m.label())).collect();

    // First pass: walk every orphan's chain to find intermediate ancestors that carry no
    // mesh and aren't in the spatial tree — those need a type label from the header scan.
    let mut need_type: HashSet<u32> = HashSet::new();
    for m in &orphan {
        let mut cur = m.express_id;
        for _ in 0..64 {
            let Some(&p) = links.get(&cur) else { break };
            if seen.contains(&p) {
                break;
            }
            if !mesh_label.contains_key(&p) {
                need_type.insert(p);
            }
            cur = p;
        }
    }
    let types = crate::relations::entity_types(ifc_bytes, &need_type);
    let label_of = |id: u32| -> String {
        mesh_label.get(&id).cloned().unwrap_or_else(|| {
            types
                .get(&id)
                .map(|t| format!("{t}#{id}"))
                .unwrap_or_else(|| format!("#{id}"))
        })
    };

    // Second pass: emit entries along each chain (child → parent), stopping when the chain
    // reaches a node already emitted.
    for m in &orphan {
        let mut cur = m.express_id;
        for _ in 0..64 {
            if seen.contains(&cur) {
                break;
            }
            let parent = links.get(&cur).copied();
            seen.insert(cur);
            out.push(HierNode {
                id: cur,
                name: label_of(cur),
                parent,
            });
            match parent {
                Some(p) => cur = p,
                None => break,
            }
        }
    }
    out
}

fn walk_hierarchy(
    node: &QuickMetadataSpatialNode,
    parent: Option<u32>,
    out: &mut Vec<HierNode>,
    seen: &mut std::collections::HashSet<u32>,
) {
    let id = node.summary.express_id;
    if seen.insert(id) {
        out.push(HierNode {
            id,
            name: summary_label(&node.summary.name, &node.summary.type_name, id),
            parent,
        });
    }
    for el in &node.elements {
        if seen.insert(el.express_id) {
            out.push(HierNode {
                id: el.express_id,
                name: summary_label(&el.name, &el.type_name, el.express_id),
                parent: Some(id),
            });
        }
    }
    for child in &node.children {
        walk_hierarchy(child, Some(id), out, seen);
    }
}

fn summary_label(name: &str, type_name: &str, id: u32) -> String {
    let n = name.trim();
    if n.is_empty() {
        format!("{type_name}#{id}")
    } else {
        n.to_string()
    }
}

fn result_warnings(_result: &ProcessingResult) -> Vec<String> {
    // ifc-lite surfaces diagnostics separately; none folded in for the POC.
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh(id: u32, color: [f32; 4]) -> Mesh {
        Mesh {
            express_id: id,
            ifc_type: "IfcWall".into(),
            name: None,
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            normals: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            indices: vec![0, 1, 2],
            color,
            uvs: None,
            texture: None,
        }
    }

    #[test]
    fn bucket_no_split_is_one_group() {
        let meshes = vec![mesh(1, [1.0, 0.0, 0.0, 1.0]), mesh(2, [0.0, 1.0, 0.0, 1.0])];
        let def = Group {
            node_id: 0,
            name: "model".into(),
        };
        let b = bucket(&meshes, &HashMap::new(), &def);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].1.len(), 2);
    }

    #[test]
    fn unique_name_disambiguates() {
        let mut used = HashMap::new();
        assert_eq!(unique_name(&mut used, "Level", false), "Level.glb");
        assert_eq!(unique_name(&mut used, "Level", false), "Level_2.glb");
        assert_eq!(unique_name(&mut used, "Cooked", true), "Cooked.tdp");
    }
}
