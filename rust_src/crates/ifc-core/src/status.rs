//! `status_file.json`: a manifest of what a conversion produced — one entry per output
//! GLB (root name, counts, byte size, world bbox) plus the model-level context. The
//! analogue of rvm2glb's `status_file.json`, adapted to IFC.

use serde_json::{Value, json};

/// Per-output-file metadata.
#[derive(Debug, Clone)]
pub struct FileMeta {
    pub file_name: String,
    pub root_name: String,
    pub node_count: u32,
    pub triangle_count: u32,
    pub glb_bytes: usize,
    pub bbox_min: [f32; 3],
    pub bbox_max: [f32; 3],
}

/// Build the `status_file.json` bytes from the model context and per-file metadata.
#[allow(clippy::too_many_arguments)]
pub fn build(
    source_file_name: &str,
    schema: Option<&str>,
    length_unit_scale: Option<f64>,
    mode: &str,
    split: &str,
    files: &[FileMeta],
    warnings: &[String],
) -> Vec<u8> {
    let file_entries: Vec<Value> = files
        .iter()
        .map(|f| {
            json!({
                "file_name": f.file_name,
                "root_name": f.root_name,
                "node_count": f.node_count,
                "triangle_count": f.triangle_count,
                "glb_bytes": f.glb_bytes,
                "min_x": f.bbox_min[0], "min_y": f.bbox_min[1], "min_z": f.bbox_min[2],
                "max_x": f.bbox_max[0], "max_y": f.bbox_max[1], "max_z": f.bbox_max[2],
            })
        })
        .collect();

    let doc = json!({
        "source_file_name": source_file_name,
        "schema": schema,
        "length_unit_scale": length_unit_scale,
        "mode": mode,
        "split": split,
        "file_count": files.len(),
        "files": file_entries,
        "warnings": warnings,
    });
    serde_json::to_vec_pretty(&doc).expect("status json serialization")
}
