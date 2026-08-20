//! Minimal GLB reader for merged (rvm2glb) files — replaces the heavyweight
//! `gltf` crate so the wasm build stays small. Parses the JSON + BIN chunks
//! and pulls exactly what the cooker needs: per-`node<N>` positions / indices /
//! base color, plus `asset.extras` and `scene[0].extras` for the merged
//! draw-range and hierarchy tables.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;

pub struct Glb {
    pub json: Value,
    pub bin: Vec<u8>,
}

/// One geometry node (`node<N>`): positions still in glTF Y-up (the cooker
/// rotates), indices flattened to u32.
pub struct NodeGeometry {
    pub node_index: usize,
    pub positions: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
    pub base_color: [f32; 4],
}

pub fn parse_glb(bytes: &[u8]) -> Result<Glb> {
    if bytes.len() < 12 || &bytes[0..4] != b"glTF" {
        bail!("not a GLB file (bad magic)");
    }
    let mut off = 12usize;
    let mut json: Option<Value> = None;
    let mut bin: Vec<u8> = Vec::new();
    while off + 8 <= bytes.len() {
        let len = u32::from_le_bytes(bytes[off..off + 4].try_into().unwrap()) as usize;
        let kind = &bytes[off + 4..off + 8];
        let body = bytes
            .get(off + 8..off + 8 + len)
            .ok_or_else(|| anyhow!("truncated GLB chunk"))?;
        match kind {
            b"JSON" => json = Some(serde_json::from_slice(body).context("GLB JSON chunk")?),
            b"BIN\0" => bin = body.to_vec(),
            _ => {}
        }
        off += 8 + len;
    }
    Ok(Glb {
        json: json.ok_or_else(|| anyhow!("GLB has no JSON chunk"))?,
        bin,
    })
}

/// Raw bytes of accessor `idx`, honouring bufferView byteOffset/byteStride
/// (stride must equal the packed element size — rvm2glb writes packed data).
fn accessor_bytes<'a>(glb: &'a Glb, idx: usize) -> Result<(&'a [u8], u32, usize, &'a str)> {
    let acc = glb.json["accessors"]
        .get(idx)
        .ok_or_else(|| anyhow!("accessor {idx} missing"))?;
    let comp = acc["componentType"].as_u64().unwrap_or(0) as u32;
    let count = acc["count"].as_u64().unwrap_or(0) as usize;
    let ty = acc["type"].as_str().unwrap_or("");
    let bv_idx = acc["bufferView"]
        .as_u64()
        .ok_or_else(|| anyhow!("accessor {idx} has no bufferView"))? as usize;
    let bv = glb.json["bufferViews"]
        .get(bv_idx)
        .ok_or_else(|| anyhow!("bufferView {bv_idx} missing"))?;
    let bv_off = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
    let acc_off = acc["byteOffset"].as_u64().unwrap_or(0) as usize;
    let comp_size = match comp {
        5121 => 1, // u8
        5123 => 2, // u16
        5125 => 4, // u32
        5126 => 4, // f32
        c => bail!("accessor {idx}: unsupported componentType {c}"),
    };
    let elems = match ty {
        "SCALAR" => 1,
        "VEC2" => 2,
        "VEC3" => 3,
        "VEC4" => 4,
        t => bail!("accessor {idx}: unsupported type {t}"),
    };
    let elem_size = comp_size * elems;
    if let Some(stride) = bv["byteStride"].as_u64() {
        anyhow::ensure!(
            stride as usize == elem_size,
            "accessor {idx}: interleaved byteStride {stride} unsupported"
        );
    }
    let start = bv_off + acc_off;
    let bytes = glb
        .bin
        .get(start..start + count * elem_size)
        .ok_or_else(|| anyhow!("accessor {idx}: out of BIN range"))?;
    Ok((bytes, comp, count, ty))
}

fn read_positions(glb: &Glb, idx: usize) -> Result<Vec<[f32; 3]>> {
    let (bytes, comp, count, ty) = accessor_bytes(glb, idx)?;
    anyhow::ensure!(comp == 5126 && ty == "VEC3", "POSITION must be f32 VEC3");
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let b = &bytes[i * 12..i * 12 + 12];
        out.push([
            f32::from_le_bytes(b[0..4].try_into().unwrap()),
            f32::from_le_bytes(b[4..8].try_into().unwrap()),
            f32::from_le_bytes(b[8..12].try_into().unwrap()),
        ]);
    }
    Ok(out)
}

fn read_indices(glb: &Glb, idx: usize) -> Result<Vec<u32>> {
    let (bytes, comp, count, ty) = accessor_bytes(glb, idx)?;
    anyhow::ensure!(ty == "SCALAR", "indices must be SCALAR");
    let mut out = Vec::with_capacity(count);
    match comp {
        5121 => out.extend(bytes.iter().map(|&b| b as u32)),
        5123 => {
            for i in 0..count {
                out.push(u16::from_le_bytes(bytes[i * 2..i * 2 + 2].try_into().unwrap()) as u32);
            }
        }
        5125 => {
            for i in 0..count {
                out.push(u32::from_le_bytes(
                    bytes[i * 4..i * 4 + 4].try_into().unwrap(),
                ));
            }
        }
        c => bail!("indices: unsupported componentType {c}"),
    }
    Ok(out)
}

/// Extract every `node<N>` geometry node (positions still Y-up).
pub fn node_geometries(glb: &Glb) -> Result<Vec<NodeGeometry>> {
    let empty = Vec::new();
    let nodes = glb.json["nodes"].as_array().unwrap_or(&empty);
    let mut out = Vec::new();
    for node in nodes {
        let node_index = match node["name"]
            .as_str()
            .and_then(|n| n.strip_prefix("node"))
            .and_then(|s| s.parse::<usize>().ok())
        {
            Some(i) => i,
            None => continue,
        };
        let mesh_idx = match node["mesh"].as_u64() {
            Some(m) => m as usize,
            None => continue,
        };
        let prim = match glb.json["meshes"][mesh_idx]["primitives"].get(0) {
            Some(p) => p,
            None => continue,
        };
        let pos_acc = prim["attributes"]["POSITION"]
            .as_u64()
            .ok_or_else(|| anyhow!("node{node_index}: missing POSITION"))?
            as usize;
        let idx_acc = prim["indices"]
            .as_u64()
            .ok_or_else(|| anyhow!("node{node_index}: missing indices"))?
            as usize;
        let base_color = prim["material"]
            .as_u64()
            .and_then(|mi| glb.json["materials"].get(mi as usize))
            .and_then(|m| m["pbrMetallicRoughness"]["baseColorFactor"].as_array())
            .map(|a| {
                let mut c = [1.0f32; 4];
                for (k, v) in a.iter().take(4).enumerate() {
                    c[k] = v.as_f64().unwrap_or(1.0) as f32;
                }
                c
            })
            .unwrap_or([1.0, 1.0, 1.0, 1.0]);
        out.push(NodeGeometry {
            node_index,
            positions: read_positions(glb, pos_acc)?,
            indices: read_indices(glb, idx_acc)?,
            base_color,
        });
    }
    Ok(out)
}
