//! Minimal, self-contained glTF 2.0 **binary (GLB)** writer.
//!
//! `standard` mode: one glTF mesh + node per [`Mesh`], parented under a single root node
//! that rotates IFC **Z-up → glTF Y-up**. Materials are de-duplicated by colour.
//! POSITION/NORMAL are `f32` vec3 accessors; indices are `u32` scalar accessors.

use std::collections::HashMap;

use serde_json::{Value, json};

use crate::mesh::{Instance, Mesh};

// glTF component/target/mode constants.
const CT_FLOAT: u32 = 5126;
const CT_UNSIGNED_INT: u32 = 5125;
const TARGET_ARRAY_BUFFER: u32 = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER: u32 = 34963;
const MODE_TRIANGLES: u32 = 4;

const GLB_MAGIC: u32 = 0x4654_6C67; // "glTF"
const CHUNK_JSON: u32 = 0x4E4F_534A; // "JSON"
const CHUNK_BIN: u32 = 0x004E_4942; // "BIN\0"

/// IFC Z-up → glTF Y-up as a column-major node matrix: v → (x, z, −y).
const Z_UP_TO_Y_UP: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, //
    0.0, 0.0, -1.0, 0.0, //
    0.0, 1.0, 0.0, 0.0, //
    0.0, 0.0, 0.0, 1.0, //
];

/// Write `meshes` as a single-file GLB (`standard` mode): a **nested** glTF node tree that
/// mirrors the IFC spatial + decomposition hierarchy (`hierarchy`) — a node per spatial
/// container (Site / Building / Storey / …) with each element's mesh node under its parent.
/// One glTF mesh per element (a primitive per submesh). The Z-up→Y-up rotation stays a
/// matrix on the single root node so the whole tree inherits it. Elements not present in
/// `hierarchy` hang directly off the root. Includes texture attributes when a mesh carries
/// them (unlike `merged`). `Err` only on an internal out-of-range index.
pub fn write_standard(meshes: &[Mesh], hierarchy: &[HierNode]) -> Result<Vec<u8>, String> {
    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut gltf_meshes: Vec<Value> = Vec::new();
    let mut materials: Vec<Value> = Vec::new();
    let mut textures: Vec<Value> = Vec::new();
    let mut images: Vec<Value> = Vec::new();
    let mut samplers: Vec<Value> = Vec::new();
    let mut material_by_color: HashMap<[u32; 4], usize> = HashMap::new();

    // Group meshes (submeshes) by element express id, preserving first-seen order.
    let mut elem_order: Vec<u32> = Vec::new();
    let mut by_elem: HashMap<u32, Vec<usize>> = HashMap::new();
    for (i, m) in meshes.iter().enumerate() {
        if m.positions.len() / 3 == 0 || m.indices.is_empty() {
            continue;
        }
        by_elem
            .entry(m.express_id)
            .or_insert_with(|| {
                elem_order.push(m.express_id);
                Vec::new()
            })
            .push(i);
    }

    // One glTF mesh per element (a primitive per submesh). Map express id → mesh index.
    let mut mesh_of: HashMap<u32, usize> = HashMap::new();
    for &eid in &elem_order {
        let mut prims: Vec<Value> = Vec::new();
        for &mi in &by_elem[&eid] {
            let m = &meshes[mi];
            let vertex_count = m.positions.len() / 3;
            if let Some(&max_i) = m.indices.iter().max()
                && max_i as usize >= vertex_count
            {
                return Err(format!(
                    "mesh {} ({}): index {} out of range for {} vertices",
                    m.express_id, m.ifc_type, max_i, vertex_count
                ));
            }
            prims.push(build_primitive(
                m,
                true, // include textures in standard mode
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                &mut materials,
                &mut material_by_color,
                &mut textures,
                &mut images,
                &mut samplers,
            ));
        }
        if prims.is_empty() {
            continue;
        }
        let idx = gltf_meshes.len();
        gltf_meshes.push(json!({ "primitives": prims }));
        mesh_of.insert(eid, idx);
    }

    // Hierarchy lookups.
    let hmap: HashMap<u32, &HierNode> = hierarchy.iter().map(|h| (h.id, h)).collect();
    let parent_of = |id: u32| hmap.get(&id).and_then(|h| h.parent);
    let name_of = |id: u32| {
        hmap.get(&id)
            .map(|h| h.name.clone())
            .unwrap_or_else(|| format!("#{id}"))
    };

    // Needed nodes: every element with geometry + all its ancestors (stops at an already
    // visited node, which also breaks any accidental cycle).
    let mut needed: Vec<u32> = Vec::new();
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();
    for &eid in &elem_order {
        let mut cur = eid;
        loop {
            if !seen.insert(cur) {
                break;
            }
            needed.push(cur);
            match parent_of(cur) {
                Some(p) => cur = p,
                None => break,
            }
        }
    }

    // Assign glTF node indices: node 0 is the Z-up→Y-up root, needed nodes follow.
    let mut nodes: Vec<Value> = vec![Value::Null];
    let mut node_of: HashMap<u32, usize> = HashMap::new();
    for &id in &needed {
        node_of.insert(id, nodes.len());
        nodes.push(Value::Null);
    }

    // Parent→children wiring; nodes whose parent isn't in the set become scene roots.
    let mut children: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut roots: Vec<usize> = Vec::new();
    for &id in &needed {
        match parent_of(id) {
            Some(p) if node_of.contains_key(&p) => {
                children.entry(p).or_default().push(node_of[&id])
            }
            _ => roots.push(node_of[&id]),
        }
    }

    for &id in &needed {
        let mut node = serde_json::Map::new();
        node.insert("name".into(), json!(name_of(id)));
        if let Some(&mesh_idx) = mesh_of.get(&id) {
            node.insert("mesh".into(), json!(mesh_idx));
        }
        if let Some(ch) = children.get(&id) {
            node.insert("children".into(), json!(ch));
        }
        nodes[node_of[&id]] = Value::Object(node);
    }

    nodes[0] = json!({
        "name": "IFC (Z-up → Y-up)",
        "matrix": Z_UP_TO_Y_UP.to_vec(),
        "children": roots,
    });

    if materials.is_empty() {
        materials.push(default_material([0.7, 0.7, 0.7, 1.0]));
    }

    let mut gltf = json!({
        "asset": { "version": "2.0", "generator": "ifc2glb" },
        "scene": 0,
        "scenes": [{ "nodes": [0] }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "materials": materials,
        "buffers": [{ "byteLength": bin.len() }],
    });
    if !textures.is_empty() {
        gltf["textures"] = json!(textures);
        gltf["images"] = json!(images);
        gltf["samplers"] = json!(samplers);
    }

    Ok(assemble_glb(&gltf, &bin))
}

/// Write shared-mesh (`instanced` / `gpu-instanced`) output. Each template in `templates`
/// (already recentred, IFC Z-up) becomes one glTF mesh drawn once at its reference
/// position; each occurrence in `instances` re-draws its template under a template-relative
/// transform. The Z-up→Y-up rotation lives on the single root node; `center` (the recentre
/// offset) is folded into every instance transform so occurrences land correctly relative
/// to the recentred templates.
///
/// - `gpu = false` (**instanced**): plain glTF — one node per occurrence with a `matrix`.
/// - `gpu = true` (**gpu-instanced**): one node per template carrying `EXT_mesh_gpu_instancing`
///   with per-instance `TRANSLATION`/`ROTATION`/`SCALE` accessors.
pub fn write_instanced(
    templates: &[Mesh],
    instances: &[Instance],
    center: [f32; 3],
    gpu: bool,
) -> Result<Vec<u8>, String> {
    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut gltf_meshes: Vec<Value> = Vec::new();
    let mut materials: Vec<Value> = Vec::new();
    let mut textures: Vec<Value> = Vec::new();
    let mut images: Vec<Value> = Vec::new();
    let mut samplers: Vec<Value> = Vec::new();
    let mut material_by_color: HashMap<[u32; 4], usize> = HashMap::new();

    // One glTF mesh per template element (a primitive per submesh).
    let mut elem_order: Vec<u32> = Vec::new();
    let mut by_elem: HashMap<u32, Vec<usize>> = HashMap::new();
    for (i, m) in templates.iter().enumerate() {
        if m.positions.len() / 3 == 0 || m.indices.is_empty() {
            continue;
        }
        by_elem
            .entry(m.express_id)
            .or_insert_with(|| {
                elem_order.push(m.express_id);
                Vec::new()
            })
            .push(i);
    }
    let mut mesh_of: HashMap<u32, usize> = HashMap::new();
    let mut label_of: HashMap<u32, String> = HashMap::new();
    for &eid in &elem_order {
        let mut prims = Vec::new();
        for &mi in &by_elem[&eid] {
            let m = &templates[mi];
            if let Some(&max_i) = m.indices.iter().max()
                && max_i as usize >= m.positions.len() / 3
            {
                return Err(format!("instanced mesh {eid}: index {max_i} out of range"));
            }
            prims.push(build_primitive(
                m,
                true,
                &mut bin,
                &mut buffer_views,
                &mut accessors,
                &mut materials,
                &mut material_by_color,
                &mut textures,
                &mut images,
                &mut samplers,
            ));
            label_of.entry(eid).or_insert_with(|| m.label());
        }
        let idx = gltf_meshes.len();
        gltf_meshes.push(json!({ "primitives": prims }));
        mesh_of.insert(eid, idx);
    }

    // Group occurrence transforms by template. The template itself is one occurrence at
    // identity (its baked verts ARE the reference occurrence). `center` folds in as
    // N = [R | t + R·C − C] so occurrences match the recentred template geometry.
    let mut occ: HashMap<u32, Vec<[f32; 16]>> = HashMap::new();
    for &eid in &elem_order {
        occ.insert(eid, vec![IDENTITY]);
    }
    let mut inst_nodes: Vec<(usize, [f32; 16], String)> = Vec::new(); // (mesh_idx, N, name)
    for inst in instances {
        let Some(&mesh_idx) = mesh_of.get(&inst.template_express_id) else {
            continue;
        };
        let n = fold_center(&inst.transform, center);
        occ.entry(inst.template_express_id).or_default().push(n);
        inst_nodes.push((mesh_idx, n, inst.label()));
    }

    let mut nodes: Vec<Value> = vec![Value::Null]; // root
    let mut scene_children: Vec<usize> = Vec::new();

    if gpu {
        // One node per template; multiple occurrences → EXT_mesh_gpu_instancing.
        for &eid in &elem_order {
            let mesh_idx = mesh_of[&eid];
            let mats = &occ[&eid];
            let mut node = serde_json::Map::new();
            node.insert("mesh".into(), json!(mesh_idx));
            node.insert("name".into(), json!(label_of[&eid]));
            if mats.len() > 1 {
                let (t_acc, r_acc, s_acc) =
                    instance_trs_accessors(mats, &mut bin, &mut buffer_views, &mut accessors);
                node.insert(
                    "extensions".into(),
                    json!({ "EXT_mesh_gpu_instancing": { "attributes": {
                        "TRANSLATION": t_acc, "ROTATION": r_acc, "SCALE": s_acc
                    }}}),
                );
            }
            let ni = nodes.len();
            nodes.push(Value::Object(node));
            scene_children.push(ni);
        }
    } else {
        // Plain glTF: reference occurrence node per template + one node per extra instance.
        for &eid in &elem_order {
            let ni = nodes.len();
            nodes.push(json!({ "mesh": mesh_of[&eid], "name": label_of[&eid] }));
            scene_children.push(ni);
        }
        for (mesh_idx, n, name) in &inst_nodes {
            let ni = nodes.len();
            nodes.push(json!({ "mesh": mesh_idx, "matrix": n.to_vec(), "name": name }));
            scene_children.push(ni);
        }
    }

    nodes[0] = json!({
        "name": "IFC (Z-up → Y-up)",
        "matrix": Z_UP_TO_Y_UP.to_vec(),
        "children": scene_children,
    });
    if materials.is_empty() {
        materials.push(default_material([0.7, 0.7, 0.7, 1.0]));
    }

    let mut gltf = json!({
        "asset": { "version": "2.0", "generator": "ifc2glb" },
        "scene": 0,
        "scenes": [{ "nodes": [0] }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "materials": materials,
        "buffers": [{ "byteLength": bin.len() }],
    });
    if !textures.is_empty() {
        gltf["textures"] = json!(textures);
        gltf["images"] = json!(images);
        gltf["samplers"] = json!(samplers);
    }
    if gpu {
        gltf["extensionsUsed"] = json!(["EXT_mesh_gpu_instancing"]);
        gltf["extensionsRequired"] = json!(["EXT_mesh_gpu_instancing"]);
    }
    Ok(assemble_glb(&gltf, &bin))
}

/// Column-major identity mat4.
const IDENTITY: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// Turn a template-relative **row-major** mat4 into a **column-major** glTF node matrix,
/// folding in the recentre offset `C`: for a recentred template vertex `v = world − C`,
/// this matrix maps it to the occurrence's recentred position. `N = [R | t + R·C − C]`.
fn fold_center(row_major: &[f32; 16], c: [f32; 3]) -> [f32; 16] {
    let m = row_major;
    // Rotation/scale 3x3 (row i, col j) and translation from the row-major layout.
    let r = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
    let t = [m[3], m[7], m[11]];
    // t' = t + R·C − C
    let rc = [
        r[0][0] * c[0] + r[0][1] * c[1] + r[0][2] * c[2],
        r[1][0] * c[0] + r[1][1] * c[1] + r[1][2] * c[2],
        r[2][0] * c[0] + r[2][1] * c[1] + r[2][2] * c[2],
    ];
    let tp = [
        t[0] + rc[0] - c[0],
        t[1] + rc[1] - c[1],
        t[2] + rc[2] - c[2],
    ];
    // Column-major: col j = (r[0][j], r[1][j], r[2][j], 0), last col = (t', 1).
    [
        r[0][0], r[1][0], r[2][0], 0.0, //
        r[0][1], r[1][1], r[2][1], 0.0, //
        r[0][2], r[1][2], r[2][2], 0.0, //
        tp[0], tp[1], tp[2], 1.0,
    ]
}

/// Decompose column-major mats into per-instance TRANSLATION/ROTATION(quat)/SCALE
/// accessors for `EXT_mesh_gpu_instancing`. Returns the three accessor indices.
fn instance_trs_accessors(
    mats: &[[f32; 16]],
    bin: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    accessors: &mut Vec<Value>,
) -> (usize, usize, usize) {
    let mut trans: Vec<f32> = Vec::with_capacity(mats.len() * 3);
    let mut rot: Vec<f32> = Vec::with_capacity(mats.len() * 4);
    let mut scale: Vec<f32> = Vec::with_capacity(mats.len() * 3);
    for m in mats {
        let (t, q, s) = decompose_trs(m);
        trans.extend_from_slice(&t);
        rot.extend_from_slice(&q);
        scale.extend_from_slice(&s);
    }
    let count = mats.len();
    let tv = push_view(
        bin,
        buffer_views,
        f32_bytes(&trans),
        Some(TARGET_ARRAY_BUFFER),
    );
    let t_acc = accessors.len();
    accessors.push(
        json!({ "bufferView": tv, "componentType": CT_FLOAT, "count": count, "type": "VEC3" }),
    );
    let rv = push_view(
        bin,
        buffer_views,
        f32_bytes(&rot),
        Some(TARGET_ARRAY_BUFFER),
    );
    let r_acc = accessors.len();
    accessors.push(
        json!({ "bufferView": rv, "componentType": CT_FLOAT, "count": count, "type": "VEC4" }),
    );
    let sv = push_view(
        bin,
        buffer_views,
        f32_bytes(&scale),
        Some(TARGET_ARRAY_BUFFER),
    );
    let s_acc = accessors.len();
    accessors.push(
        json!({ "bufferView": sv, "componentType": CT_FLOAT, "count": count, "type": "VEC3" }),
    );
    (t_acc, r_acc, s_acc)
}

/// Decompose a column-major mat4 into (translation, rotation quaternion [x,y,z,w], scale).
fn decompose_trs(m: &[f32; 16]) -> ([f32; 3], [f32; 4], [f32; 3]) {
    let t = [m[12], m[13], m[14]];
    let len = |a: f32, b: f32, c: f32| (a * a + b * b + c * c).sqrt();
    let mut sx = len(m[0], m[1], m[2]);
    let sy = len(m[4], m[5], m[6]);
    let sz = len(m[8], m[9], m[10]);
    // Negative determinant → flip one axis so the rotation stays proper.
    let det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9])
        + m[8] * (m[1] * m[6] - m[2] * m[5]);
    if det < 0.0 {
        sx = -sx;
    }
    let (isx, isy, isz) = (
        if sx != 0.0 { 1.0 / sx } else { 0.0 },
        if sy != 0.0 { 1.0 / sy } else { 0.0 },
        if sz != 0.0 { 1.0 / sz } else { 0.0 },
    );
    // Rotation matrix rij (row i, col j) from normalized columns.
    let r00 = m[0] * isx;
    let r10 = m[1] * isx;
    let r20 = m[2] * isx;
    let r01 = m[4] * isy;
    let r11 = m[5] * isy;
    let r21 = m[6] * isy;
    let r02 = m[8] * isz;
    let r12 = m[9] * isz;
    let r22 = m[10] * isz;
    let trace = r00 + r11 + r22;
    let q = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        [(r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, 0.25 * s]
    } else if r00 > r11 && r00 > r22 {
        let s = (1.0 + r00 - r11 - r22).sqrt() * 2.0;
        [0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s]
    } else if r11 > r22 {
        let s = (1.0 + r11 - r00 - r22).sqrt() * 2.0;
        [(r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s]
    } else {
        let s = (1.0 + r22 - r00 - r11).sqrt() * 2.0;
        [(r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s]
    };
    (t, q, [sx, sy, sz])
}

/// Build one glTF primitive from a mesh: POSITION (+ NORMAL, + TEXCOORD_0 when
/// `with_textures` and the mesh has UVs+texture), an index accessor, and a material
/// (colour-deduped, or a fresh textured material with an embedded PNG image).
#[allow(clippy::too_many_arguments)]
fn build_primitive(
    m: &Mesh,
    with_textures: bool,
    bin: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    accessors: &mut Vec<Value>,
    materials: &mut Vec<Value>,
    material_by_color: &mut HashMap<[u32; 4], usize>,
    textures: &mut Vec<Value>,
    images: &mut Vec<Value>,
    samplers: &mut Vec<Value>,
) -> Value {
    let vertex_count = m.positions.len() / 3;
    let (min, max) = bounds(&m.positions);
    let pos_view = push_view(
        bin,
        buffer_views,
        f32_bytes(&m.positions),
        Some(TARGET_ARRAY_BUFFER),
    );
    let pos_accessor = accessors.len();
    accessors.push(json!({
        "bufferView": pos_view, "componentType": CT_FLOAT,
        "count": vertex_count, "type": "VEC3", "min": min, "max": max,
    }));
    let mut attributes = json!({ "POSITION": pos_accessor });

    if m.normals.len() == m.positions.len() {
        let nv = push_view(
            bin,
            buffer_views,
            f32_bytes(&m.normals),
            Some(TARGET_ARRAY_BUFFER),
        );
        let a = accessors.len();
        accessors.push(json!({
            "bufferView": nv, "componentType": CT_FLOAT, "count": vertex_count, "type": "VEC3",
        }));
        attributes["NORMAL"] = json!(a);
    }

    let textured = with_textures
        && m.uvs.as_ref().is_some_and(|u| u.len() == vertex_count * 2)
        && m.texture.as_ref().is_some_and(|t| {
            t.width > 0
                && t.height > 0
                && t.rgba.len() == (t.width as usize) * (t.height as usize) * 4
        });
    if textured {
        let uvs = m.uvs.as_ref().unwrap();
        let uv_view = push_view(bin, buffer_views, f32_bytes(uvs), Some(TARGET_ARRAY_BUFFER));
        let a = accessors.len();
        accessors.push(json!({
            "bufferView": uv_view, "componentType": CT_FLOAT, "count": vertex_count, "type": "VEC2",
        }));
        attributes["TEXCOORD_0"] = json!(a);
    }

    let idx_view = push_view(
        bin,
        buffer_views,
        u32_bytes(&m.indices),
        Some(TARGET_ELEMENT_ARRAY_BUFFER),
    );
    let idx_accessor = accessors.len();
    accessors.push(json!({
        "bufferView": idx_view, "componentType": CT_UNSIGNED_INT,
        "count": m.indices.len(), "type": "SCALAR",
    }));

    let material = if textured {
        textured_material(m, bin, buffer_views, materials, textures, images, samplers)
    } else {
        material_index(materials, material_by_color, m.color)
    };

    json!({
        "attributes": attributes,
        "indices": idx_accessor,
        "material": material,
        "mode": MODE_TRIANGLES,
    })
}

/// One node in the treeview hierarchy carried by `merged` output: an id, a display name,
/// and the parent id (`None` = a root, serialised as `"*"`). Built from the IFC spatial
/// structure (Project → Site → Building → Storey → element).
#[derive(Debug, Clone)]
pub struct HierNode {
    pub id: u32,
    pub name: String,
    pub parent: Option<u32>,
}

/// One merged, single-colour node captured out of the merged build — the same
/// buffers the GLB would have carried, without the glTF wrapper.
///
/// `positions` are glTF space (**Y-up**, xyz triples), because the merged build
/// bakes IFC Z-up → Y-up while flattening; the cooker bridge rotates back with
/// the same `[x, -z, y]` it applies when reading a GLB, so the direct path and
/// the GLB path cook identical bytes.
pub struct MergedNodeData {
    pub base_color: [f32; 4],
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    /// `(id, index_start, index_count)` per item inside this node.
    pub draw_ranges: Vec<(u32, u32, u32)>,
}

/// A whole merged export in memory — what [`write_merged`] would have serialised.
pub struct MergedData {
    pub nodes: Vec<MergedNodeData>,
    /// `(id, name, parent_id)`; `None` parent marks a root.
    pub hierarchy: Vec<(u32, String, Option<u32>)>,
}

/// The merged build WITHOUT the glTF wrapper: same grouping, colour parts and
/// draw ranges, handed back in memory for a direct cook. Nothing is serialised.
pub fn build_merged(meshes: &[Mesh], hierarchy: &[HierNode]) -> Result<MergedData, String> {
    let (_, merged) = write_merged_inner(meshes, hierarchy, false)?;
    merged.ok_or_else(|| "merged build produced no data".to_string())
}

/// Write `meshes` as a single-file GLB (`merged` mode), matching rvm2glb's merged output
/// shape exactly so web3d viewers built against it work unchanged:
///
/// - **No wrapper node**: the Z-up→Y-up rotation is baked into the vertex data
///   (`v → (x, z, −y)`), and the colour mesh nodes ARE the scene nodes — glTF node `N` is
///   colour `N`, named `node<N>`.
/// - `asset.extras.web3dversion = 2`
/// - `scene.extras.id_hierarchy = { "<id>": [name, parent] }` where `parent` is `"*"` for a
///   root, else the parent id as a string. Built from `hierarchy` (the IFC spatial tree);
///   any mesh whose id isn't in the tree is added flat (`parent = "*"`).
/// - `scene.extras.draw_ranges_node<N> = { "<express_id>": [index_start, index_count] }`
///   giving each element's slice of glTF node `N`'s index buffer.
pub fn write_merged(meshes: &[Mesh], hierarchy: &[HierNode]) -> Result<Vec<u8>, String> {
    write_merged_inner(meshes, hierarchy, true).map(|(glb, _)| glb)
}

/// Shared body: `want_glb` picks the tail — serialise a GLB, or hand the merged
/// buffers back for a direct cook.
fn write_merged_inner(
    meshes: &[Mesh],
    hierarchy: &[HierNode],
    want_glb: bool,
) -> Result<(Vec<u8>, Option<MergedData>), String> {
    let mut merged_nodes: Vec<MergedNodeData> = Vec::new();
    // Group submeshes by element (express id), first-seen order.
    let mut elem_order: Vec<u32> = Vec::new();
    let mut elem_meshes: HashMap<u32, Vec<usize>> = HashMap::new();
    for (i, m) in meshes.iter().enumerate() {
        if m.positions.len() < 9 || m.indices.is_empty() {
            continue;
        }
        elem_meshes
            .entry(m.express_id)
            .or_insert_with(|| {
                elem_order.push(m.express_id);
                Vec::new()
            })
            .push(i);
    }

    // Seed id_hierarchy from the spatial tree: {id: [name, parent]} with "*" for roots.
    let mut id_hierarchy = serde_json::Map::new();
    for h in hierarchy {
        let parent = match h.parent {
            Some(p) => p.to_string(),
            None => "*".to_string(),
        };
        id_hierarchy.insert(h.id.to_string(), json!([h.name, parent]));
    }

    // Synthetic id source for the colour-part child nodes of multi-colour elements —
    // starts above every real id so it can never collide with an express id.
    let mut next_synth: u32 = meshes
        .iter()
        .map(|m| m.express_id)
        .chain(hierarchy.iter().map(|h| h.id))
        .max()
        .unwrap_or(0)
        .saturating_add(1);

    // Build the colour PARTS: one part = one colour of one element (contiguous). A
    // single-colour element is one part keyed by its express id (a tree leaf). A
    // multi-colour element (e.g. a window's frame + glass) becomes a tree CONTAINER whose
    // colour parts are child nodes — selecting the element then highlights every part,
    // while each part keeps its own colour and lives in exactly one colour node.
    struct Part {
        id: u32,
        meshes: Vec<usize>,
    }
    let mut order: Vec<[u32; 4]> = Vec::new();
    let mut groups: HashMap<[u32; 4], Vec<Part>> = HashMap::new();
    for &eid in &elem_order {
        // Group this element's submeshes by colour, first-seen.
        let mut c_order: Vec<[u32; 4]> = Vec::new();
        let mut c_map: HashMap<[u32; 4], Vec<usize>> = HashMap::new();
        for &mi in &elem_meshes[&eid] {
            let ck = color_key(meshes[mi].color);
            c_map.entry(ck).or_insert_with(|| {
                c_order.push(ck);
                Vec::new()
            });
            c_map.get_mut(&ck).unwrap().push(mi);
        }
        let label = elem_meshes[&eid]
            .first()
            .map(|&mi| meshes[mi].label())
            .unwrap_or_default();
        // Ensure the element itself has a tree entry (flat "*" if not in the spatial tree).
        id_hierarchy
            .entry(eid.to_string())
            .or_insert_with(|| json!([label.clone(), "*"]));

        let multi = c_order.len() > 1;
        for (n, ck) in c_order.iter().enumerate() {
            let part_id = if multi {
                let id = next_synth;
                next_synth += 1;
                // Child of the element in the tree.
                id_hierarchy.insert(
                    id.to_string(),
                    json!([format!("{label} · part {}", n + 1), eid.to_string()]),
                );
                id
            } else {
                eid
            };
            let part = Part {
                id: part_id,
                meshes: c_map.remove(ck).unwrap(),
            };
            groups.entry(*ck).or_insert_with(|| {
                order.push(*ck);
                Vec::new()
            });
            groups.get_mut(ck).unwrap().push(part);
        }
    }

    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut gltf_meshes: Vec<Value> = Vec::new();
    let mut nodes: Vec<Value> = Vec::new();
    let mut materials: Vec<Value> = Vec::new();
    let mut child_node_indices: Vec<usize> = Vec::new();
    let mut extras = serde_json::Map::new();

    for key in order.iter() {
        let parts = &groups[key];

        let mut positions: Vec<f32> = Vec::new();
        let mut normals: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut all_have_normals = true;
        let mut draw_ranges = serde_json::Map::new();

        // Each part's submeshes are emitted contiguously → one draw range per part.
        for part in parts {
            let start = indices.len() as u32;
            for &mi in &part.meshes {
                let m = &meshes[mi];
                let base = (positions.len() / 3) as u32;
                // Bake IFC Z-up → glTF Y-up into the vertex data (rvm2glb parity: no wrapper
                // node with a matrix — viewers index draw_ranges by raw node number).
                for p in m.positions.chunks_exact(3) {
                    positions.extend_from_slice(&[p[0], p[2], -p[1]]);
                }
                if m.normals.len() == m.positions.len() {
                    for n in m.normals.chunks_exact(3) {
                        normals.extend_from_slice(&[n[0], n[2], -n[1]]);
                    }
                } else {
                    all_have_normals = false;
                }
                for &idx in &m.indices {
                    indices.push(base + idx);
                }
            }
            let count = indices.len() as u32 - start;
            draw_ranges.insert(part.id.to_string(), serde_json::json!([start, count]));
        }

        // Direct (GLB-free) path: keep the buffers, skip every accessor /
        // bufferView / material / JSON step below.
        if !want_glb {
            merged_nodes.push(MergedNodeData {
                base_color: unkey_color(*key),
                positions,
                indices,
                draw_ranges: draw_ranges
                    .iter()
                    .map(|(id, v)| {
                        let a = v.as_array().expect("draw range is [start, count]");
                        (
                            id.parse::<u32>().expect("draw range key is a u32 id"),
                            a[0].as_u64().unwrap_or(0) as u32,
                            a[1].as_u64().unwrap_or(0) as u32,
                        )
                    })
                    .collect(),
            });
            continue;
        }

        let vertex_count = positions.len() / 3;
        let (min, max) = bounds(&positions);
        let pos_view = push_view(
            &mut bin,
            &mut buffer_views,
            f32_bytes(&positions),
            Some(TARGET_ARRAY_BUFFER),
        );
        let pos_accessor = accessors.len();
        accessors.push(json!({
            "bufferView": pos_view, "componentType": CT_FLOAT,
            "count": vertex_count, "type": "VEC3", "min": min, "max": max,
        }));

        let mut attributes = json!({ "POSITION": pos_accessor });
        if all_have_normals && normals.len() == positions.len() {
            let nv = push_view(
                &mut bin,
                &mut buffer_views,
                f32_bytes(&normals),
                Some(TARGET_ARRAY_BUFFER),
            );
            let a = accessors.len();
            accessors.push(json!({
                "bufferView": nv, "componentType": CT_FLOAT, "count": vertex_count, "type": "VEC3",
            }));
            attributes["NORMAL"] = json!(a);
        }

        let idx_view = push_view(
            &mut bin,
            &mut buffer_views,
            u32_bytes(&indices),
            Some(TARGET_ELEMENT_ARRAY_BUFFER),
        );
        let idx_accessor = accessors.len();
        accessors.push(json!({
            "bufferView": idx_view, "componentType": CT_UNSIGNED_INT,
            "count": indices.len(), "type": "SCALAR",
            "min": [0], "max": [vertex_count.saturating_sub(1)],
        }));

        let material = materials.len();
        materials.push(default_material(unkey_color(*key)));

        let mesh_index = gltf_meshes.len();
        gltf_meshes.push(json!({
            "primitives": [{
                "attributes": attributes, "indices": idx_accessor,
                "material": material, "mode": MODE_TRIANGLES,
            }],
        }));

        // rvm2glb parity: the colour node IS scene node <N>, named node<N>, and
        // draw_ranges_node<N> keys match it 1:1.
        let node_index = nodes.len();
        nodes.push(json!({ "mesh": mesh_index, "name": format!("node{node_index}") }));
        child_node_indices.push(node_index);
        extras.insert(
            format!("draw_ranges_node{node_index}"),
            Value::Object(draw_ranges),
        );
    }

    if materials.is_empty() {
        materials.push(default_material([0.7, 0.7, 0.7, 1.0]));
    }
    if nodes.is_empty() {
        nodes.push(json!({ "name": "node0" }));
        child_node_indices.push(0);
    }

    if !want_glb {
        // `id_hierarchy` is the authority (it gained flat entries and the
        // synthetic colour-part children while grouping) — decode it back.
        let hierarchy = id_hierarchy
            .iter()
            .filter_map(|(id, v)| {
                let a = v.as_array()?;
                let name = a[0].as_str()?.to_string();
                let parent = a[1].as_str()?;
                let parent_id = (parent != "*").then(|| parent.parse::<u32>().ok()).flatten();
                Some((id.parse::<u32>().ok()?, name, parent_id))
            })
            .collect();
        return Ok((
            Vec::new(),
            Some(MergedData {
                nodes: merged_nodes,
                hierarchy,
            }),
        ));
    }

    extras.insert("id_hierarchy".to_string(), Value::Object(id_hierarchy));

    let gltf = json!({
        "asset": { "version": "2.0", "generator": "ifc2glb", "extras": { "web3dversion": 2 } },
        "scene": 0,
        "scenes": [{ "nodes": child_node_indices, "extras": extras }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "materials": materials,
        "buffers": [{ "byteLength": bin.len() }],
    });
    Ok((assemble_glb(&gltf, &bin), None))
}

/// Emit a textured PBR material with the mesh's texture embedded as a PNG image in the GLB
/// binary buffer. Returns the material index.
#[allow(clippy::too_many_arguments)]
fn textured_material(
    m: &Mesh,
    bin: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    materials: &mut Vec<Value>,
    textures: &mut Vec<Value>,
    images: &mut Vec<Value>,
    samplers: &mut Vec<Value>,
) -> usize {
    let tex = m.texture.as_ref().unwrap();
    let png = encode_png(&tex.rgba, tex.width, tex.height);
    let img_view = push_view(bin, buffer_views, png, None); // image data: no target
    let image_idx = images.len();
    images.push(json!({ "bufferView": img_view, "mimeType": "image/png" }));

    let wrap = |repeat: bool| if repeat { 10497 } else { 33071 }; // REPEAT / CLAMP_TO_EDGE
    let sampler_idx = samplers.len();
    samplers.push(json!({ "wrapS": wrap(tex.repeat_s), "wrapT": wrap(tex.repeat_t) }));
    let texture_idx = textures.len();
    textures.push(json!({ "source": image_idx, "sampler": sampler_idx }));

    let a = m.color[3];
    let alpha_mode = if a < 1.0 { "BLEND" } else { "OPAQUE" };
    let idx = materials.len();
    materials.push(json!({
        "pbrMetallicRoughness": {
            "baseColorTexture": { "index": texture_idx },
            "baseColorFactor": [1.0, 1.0, 1.0, a],
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0,
        },
        "doubleSided": true,
        "alphaMode": alpha_mode,
    }));
    idx
}

/// Encode straight-alpha RGBA8 pixels into PNG bytes for GLB embedding.
fn encode_png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut enc = png::Encoder::new(&mut out, width, height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut writer = enc.write_header().expect("png header");
    writer.write_image_data(rgba).expect("png data");
    writer.finish().expect("png finish");
    out
}

fn color_key(c: [f32; 4]) -> [u32; 4] {
    [
        c[0].to_bits(),
        c[1].to_bits(),
        c[2].to_bits(),
        c[3].to_bits(),
    ]
}

fn unkey_color(k: [u32; 4]) -> [f32; 4] {
    [
        f32::from_bits(k[0]),
        f32::from_bits(k[1]),
        f32::from_bits(k[2]),
        f32::from_bits(k[3]),
    ]
}

fn material_index(
    materials: &mut Vec<Value>,
    by_color: &mut HashMap<[u32; 4], usize>,
    color: [f32; 4],
) -> usize {
    let key = [
        color[0].to_bits(),
        color[1].to_bits(),
        color[2].to_bits(),
        color[3].to_bits(),
    ];
    if let Some(&i) = by_color.get(&key) {
        return i;
    }
    let i = materials.len();
    materials.push(default_material(color));
    by_color.insert(key, i);
    i
}

fn default_material(color: [f32; 4]) -> Value {
    let alpha_mode = if color[3] < 1.0 { "BLEND" } else { "OPAQUE" };
    json!({
        "pbrMetallicRoughness": {
            "baseColorFactor": color,
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0,
        },
        "doubleSided": true,
        "alphaMode": alpha_mode,
    })
}

/// Append `data` to `bin` (4-byte aligned) and register a bufferView over it. Returns the
/// bufferView index.
fn push_view(
    bin: &mut Vec<u8>,
    views: &mut Vec<Value>,
    data: Vec<u8>,
    target: Option<u32>,
) -> usize {
    pad_to_4(bin);
    let offset = bin.len();
    bin.extend_from_slice(&data);
    let mut view = json!({
        "buffer": 0,
        "byteOffset": offset,
        "byteLength": data.len(),
    });
    if let Some(t) = target {
        view["target"] = json!(t);
    }
    let idx = views.len();
    views.push(view);
    idx
}

fn bounds(positions: &[f32]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for p in positions.chunks_exact(3) {
        for k in 0..3 {
            min[k] = min[k].min(p[k]);
            max[k] = max[k].max(p[k]);
        }
    }
    (min, max)
}

fn f32_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for &x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn u32_bytes(v: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for &x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn pad_to_4(v: &mut Vec<u8>) {
    while !v.len().is_multiple_of(4) {
        v.push(0);
    }
}

/// Wrap the glTF JSON + binary buffer into the 12-byte-header GLB container.
fn assemble_glb(gltf: &Value, bin: &[u8]) -> Vec<u8> {
    let mut json_chunk = serde_json::to_vec(gltf).expect("glTF JSON serialization");
    while !json_chunk.len().is_multiple_of(4) {
        json_chunk.push(b' ');
    }
    let mut bin_chunk = bin.to_vec();
    while !bin_chunk.len().is_multiple_of(4) {
        bin_chunk.push(0);
    }

    let total = 12 + 8 + json_chunk.len() + 8 + bin_chunk.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes()); // version
    out.extend_from_slice(&(total as u32).to_le_bytes());

    out.extend_from_slice(&(json_chunk.len() as u32).to_le_bytes());
    out.extend_from_slice(&CHUNK_JSON.to_le_bytes());
    out.extend_from_slice(&json_chunk);

    out.extend_from_slice(&(bin_chunk.len() as u32).to_le_bytes());
    out.extend_from_slice(&CHUNK_BIN.to_le_bytes());
    out.extend_from_slice(&bin_chunk);

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::MeshTexture;

    fn tri() -> Mesh {
        Mesh {
            express_id: 1,
            ifc_type: "IfcWall".into(),
            name: Some("W1".into()),
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            normals: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            indices: vec![0, 1, 2],
            color: [1.0, 0.0, 0.0, 1.0],
            uvs: None,
            texture: None,
        }
    }

    #[test]
    fn writes_valid_glb_container() {
        let glb = write_standard(&[tri()], &[]).unwrap();
        assert_eq!(&glb[0..4], b"glTF");
        assert_eq!(
            u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize,
            glb.len()
        );
        assert_eq!(&glb[16..20], b"JSON");
        assert_eq!(glb.len() % 4, 0);
    }

    #[test]
    fn out_of_range_index_is_rejected() {
        let mut m = tri();
        m.indices = vec![0, 1, 9];
        assert!(write_standard(&[m], &[]).is_err());
    }

    #[test]
    fn merged_groups_by_colour_with_web3d_extras() {
        let red = tri();
        let mut red2 = tri();
        red2.express_id = 2;
        let mut green = tri();
        green.express_id = 3;
        green.color = [0.0, 1.0, 0.0, 1.0];
        // Hierarchy: a storey #10 root, elements 1 & 2 under it, 3 left to fall back flat.
        let hier = vec![
            HierNode {
                id: 10,
                name: "Storey".into(),
                parent: None,
            },
            HierNode {
                id: 1,
                name: "W1".into(),
                parent: Some(10),
            },
            HierNode {
                id: 2,
                name: "W2".into(),
                parent: Some(10),
            },
        ];
        let glb = write_merged(&[red, red2, green], &hier).unwrap();
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json: Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        // two colours → two merged meshes + root node = 3 nodes
        assert_eq!(json["meshes"].as_array().unwrap().len(), 2);
        assert_eq!(json["materials"].as_array().unwrap().len(), 2);
        assert_eq!(json["asset"]["extras"]["web3dversion"], 2);
        let extras = &json["scenes"][0]["extras"];
        let hierj = extras["id_hierarchy"].as_object().unwrap();
        // storey + 3 elements = 4 entries
        assert_eq!(hierj.len(), 4);
        assert_eq!(hierj["10"], json!(["Storey", "*"])); // root parent "*"
        assert_eq!(hierj["1"], json!(["W1", "10"])); // real string parent
        assert_eq!(hierj["3"], json!(["W1 (IfcWall#3)", "*"])); // flat fallback (mesh label)
        // rvm2glb parity: NO wrapper node — colour node 0 is scene node 0, named node0,
        // and draw_ranges_node<N> matches glTF node N exactly.
        assert_eq!(json["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(json["nodes"][0]["name"], "node0");
        assert!(json["nodes"][0].get("matrix").is_none()); // rotation baked into verts
        assert_eq!(json["scenes"][0]["nodes"], json!([0, 1]));
        assert_eq!(extras["draw_ranges_node0"].as_object().unwrap().len(), 2); // red
        assert_eq!(extras["draw_ranges_node1"].as_object().unwrap().len(), 1); // green
        // Z-up→Y-up baked into POSITION min/max: input y∈[0,1] z=0 → y'=0, z'∈[-1,0]
        let pos_acc = &json["accessors"]
            [json["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
                .as_u64()
                .unwrap() as usize];
        assert_eq!(pos_acc["min"], json!([0.0, 0.0, -1.0]));
        assert_eq!(pos_acc["max"], json!([1.0, 0.0, 0.0]));
    }

    #[test]
    fn merged_multicolour_element_becomes_container_with_part_children() {
        // One element (id 5) with two submeshes of DIFFERENT colours → a tree container
        // whose two colour parts are child nodes; each part has its own draw range in its
        // own colour node, and the element itself carries no draw range.
        let mut frame = tri();
        frame.express_id = 5;
        frame.name = Some("Window".into());
        frame.color = [0.6, 0.4, 0.2, 1.0];
        let mut glass = tri();
        glass.express_id = 5;
        glass.name = Some("Window".into());
        glass.color = [0.2, 0.5, 0.9, 0.4];
        let glb = write_merged(&[frame, glass], &[]).unwrap();
        let jl = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let j: Value = serde_json::from_slice(&glb[20..20 + jl]).unwrap();
        assert_eq!(j["meshes"].as_array().unwrap().len(), 2); // two colour nodes
        let extras = &j["scenes"][0]["extras"];
        let hier = extras["id_hierarchy"].as_object().unwrap();
        assert!(hier.contains_key("5"));
        let children: Vec<_> = hier.iter().filter(|(_, v)| v[1] == "5").collect();
        assert_eq!(children.len(), 2, "expected 2 colour-part children");
        let mut nodes_of: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for (k, v) in extras.as_object().unwrap() {
            if let Some(map) = k.strip_prefix("draw_ranges_node").and(v.as_object()) {
                for id in map.keys() {
                    *nodes_of.entry(id.clone()).or_default() += 1;
                }
            }
        }
        assert!(
            !nodes_of.contains_key("5"),
            "container must have no draw range"
        );
        for (part_id, _) in &children {
            assert_eq!(nodes_of.get(*part_id), Some(&1), "part in exactly one node");
        }
    }

    #[test]
    fn standard_nests_elements_under_spatial_parent() {
        let mut a = tri();
        a.express_id = 1;
        let mut b = tri();
        b.express_id = 2;
        // Storey #10 (no geometry) parents both elements.
        let hier = vec![
            HierNode {
                id: 10,
                name: "Ground Floor".into(),
                parent: None,
            },
            HierNode {
                id: 1,
                name: "W1".into(),
                parent: Some(10),
            },
            HierNode {
                id: 2,
                name: "W2".into(),
                parent: Some(10),
            },
        ];
        let glb = write_standard(&[a, b], &hier).unwrap();
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json: Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        // 2 elements → 2 meshes; nodes = rotation root + storey + 2 elements = 4
        assert_eq!(json["meshes"].as_array().unwrap().len(), 2);
        let nodes = json["nodes"].as_array().unwrap();
        assert_eq!(nodes.len(), 4);
        // root (node 0) has the rotation matrix; its child is the storey node.
        assert!(json["nodes"][0].get("matrix").is_some());
        let storey_idx = json["nodes"][0]["children"][0].as_u64().unwrap() as usize;
        let storey = &nodes[storey_idx];
        assert_eq!(storey["name"], "Ground Floor");
        assert!(storey.get("mesh").is_none()); // container, no geometry
        // the storey's two children are the element mesh nodes
        assert_eq!(storey["children"].as_array().unwrap().len(), 2);
        for c in storey["children"].as_array().unwrap() {
            assert!(nodes[c.as_u64().unwrap() as usize].get("mesh").is_some());
        }
    }

    #[test]
    fn fold_center_identity_rotation_keeps_translation() {
        // M_rel = translate(5,0,0), R = I. With any C, R·C−C = 0, so t' = t.
        let mut m = [0.0f32; 16];
        m[0] = 1.0;
        m[5] = 1.0;
        m[10] = 1.0;
        m[15] = 1.0;
        m[3] = 5.0; // row-major translation x
        let n = fold_center(&m, [1.0, 2.0, 3.0]);
        // column-major translation is n[12..15]
        assert_eq!([n[12], n[13], n[14]], [5.0, 0.0, 0.0]);
    }

    #[test]
    fn decompose_trs_roundtrips_translation_and_scale() {
        // column-major: scale (2,3,4) on the diagonal + translation (7,8,9).
        let mut m = IDENTITY;
        m[0] = 2.0;
        m[5] = 3.0;
        m[10] = 4.0;
        m[12] = 7.0;
        m[13] = 8.0;
        m[14] = 9.0;
        let (t, q, s) = decompose_trs(&m);
        assert_eq!(t, [7.0, 8.0, 9.0]);
        assert_eq!(s, [2.0, 3.0, 4.0]);
        // no rotation → identity quaternion
        assert!((q[0]).abs() < 1e-6 && (q[1]).abs() < 1e-6 && (q[2]).abs() < 1e-6);
        assert!((q[3] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn decompose_trs_roundtrips_rotations() {
        // Recompose T*R*S from decompose_trs and compare to the input column-major matrix.
        fn recompose(t: [f32; 3], q: [f32; 4], s: [f32; 3]) -> [f32; 16] {
            let [x, y, z, w] = q;
            // rotation matrix (row i, col j)
            let r = [
                [
                    1.0 - 2.0 * (y * y + z * z),
                    2.0 * (x * y - z * w),
                    2.0 * (x * z + y * w),
                ],
                [
                    2.0 * (x * y + z * w),
                    1.0 - 2.0 * (x * x + z * z),
                    2.0 * (y * z - x * w),
                ],
                [
                    2.0 * (x * z - y * w),
                    2.0 * (y * z + x * w),
                    1.0 - 2.0 * (x * x + y * y),
                ],
            ];
            // column-major: col j = rotation col j * scale[j]
            [
                r[0][0] * s[0],
                r[1][0] * s[0],
                r[2][0] * s[0],
                0.0,
                r[0][1] * s[1],
                r[1][1] * s[1],
                r[2][1] * s[1],
                0.0,
                r[0][2] * s[2],
                r[1][2] * s[2],
                r[2][2] * s[2],
                0.0,
                t[0],
                t[1],
                t[2],
                1.0,
            ]
        }
        // column-major rotations about each axis (90°) + a compound, with a translation.
        let rots: [[f32; 16]; 4] = [
            // 90° about X: (x,y,z)->(x,-z,y). cols: X=(1,0,0) Y=(0,0,1) Z=(0,-1,0)
            [
                1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 3.0, 4.0, 5.0, 1.0,
            ],
            // 90° about Y: (x,y,z)->(z,y,-x). cols: X=(0,0,-1) Y=(0,1,0) Z=(1,0,0)
            [
                0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 1.0,
            ],
            // 90° about Z: (x,y,z)->(-y,x,z). cols: X=(0,1,0) Y=(-1,0,0) Z=(0,0,1)
            [
                0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 6.0, 7.0, 8.0, 1.0,
            ],
            // 180° about Z: cols X=(-1,0,0) Y=(0,-1,0) Z=(0,0,1)  (trace ≤ 0 branch)
            [
                -1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        ];
        for (i, m) in rots.iter().enumerate() {
            let (t, q, s) = decompose_trs(m);
            let back = recompose(t, q, s);
            for k in 0..16 {
                assert!(
                    (back[k] - m[k]).abs() < 1e-4,
                    "rotation {i} elem {k}: {} vs {}",
                    back[k],
                    m[k]
                );
            }
        }
    }

    #[test]
    fn instanced_places_occurrences() {
        let template = Mesh {
            express_id: 100,
            ifc_type: "IfcColumn".into(),
            name: Some("Col".into()),
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            normals: vec![],
            indices: vec![0, 1, 2],
            color: [0.5, 0.5, 0.5, 1.0],
            uvs: None,
            texture: None,
        };
        // one extra occurrence: translate (10,0,0), R = I (row-major)
        let mut tf = [0.0f32; 16];
        tf[0] = 1.0;
        tf[5] = 1.0;
        tf[10] = 1.0;
        tf[15] = 1.0;
        tf[3] = 10.0;
        let inst = Instance {
            express_id: 101,
            ifc_type: "IfcColumn".into(),
            name: None,
            template_express_id: 100,
            transform: tf,
        };
        // instanced (plain): 1 template mesh, root + ref node + instance node = 3 nodes
        let glb = write_instanced(
            std::slice::from_ref(&template),
            std::slice::from_ref(&inst),
            [0.0; 3],
            false,
        )
        .unwrap();
        let jl = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let j: Value = serde_json::from_slice(&glb[20..20 + jl]).unwrap();
        assert_eq!(j["meshes"].as_array().unwrap().len(), 1); // shared mesh
        assert_eq!(j["nodes"].as_array().unwrap().len(), 3);
        // the instance node carries the folded matrix with translation x = 10
        let inst_node = j["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n.get("matrix").is_some() && n.get("mesh").is_some())
            .unwrap();
        let mtx = inst_node["matrix"].as_array().unwrap();
        assert_eq!(mtx[12].as_f64().unwrap(), 10.0);

        // gpu-instanced: 1 template node with EXT (2 instances: ref + occurrence)
        let glb2 = write_instanced(
            std::slice::from_ref(&template),
            std::slice::from_ref(&inst),
            [0.0; 3],
            true,
        )
        .unwrap();
        let jl2 = u32::from_le_bytes(glb2[12..16].try_into().unwrap()) as usize;
        let j2: Value = serde_json::from_slice(&glb2[20..20 + jl2]).unwrap();
        assert_eq!(j2["extensionsRequired"], json!(["EXT_mesh_gpu_instancing"]));
        let ext = &j2["nodes"][1]["extensions"]["EXT_mesh_gpu_instancing"];
        let tacc = ext["attributes"]["TRANSLATION"].as_u64().unwrap() as usize;
        assert_eq!(j2["accessors"][tacc]["count"], 2); // ref + 1 occurrence
    }

    #[test]
    fn textured_standard_emits_image_and_texcoord() {
        let mut m = tri();
        m.uvs = Some(vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0]); // 3 verts × uv
        m.texture = Some(MeshTexture {
            rgba: vec![255u8; 2 * 2 * 4], // 2×2 RGBA
            width: 2,
            height: 2,
            repeat_s: true,
            repeat_t: false,
        });
        let glb = write_standard(&[m], &[]).unwrap();
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json: Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        assert_eq!(json["images"].as_array().unwrap().len(), 1);
        assert_eq!(json["images"][0]["mimeType"], "image/png");
        assert_eq!(json["textures"].as_array().unwrap().len(), 1);
        let prim = &json["meshes"][0]["primitives"][0];
        assert!(prim["attributes"].get("TEXCOORD_0").is_some());
        assert!(
            json["materials"][prim["material"].as_u64().unwrap() as usize]["pbrMetallicRoughness"]
                .get("baseColorTexture")
                .is_some()
        );
    }
}
