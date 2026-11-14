//! HSPC ("Hexagon Smart Point Cloud") octree metadata: `hspcInfo.json` and
//! the node naming scheme of the `.apr` files in the mMapArchive.
//!
//! Integer grid: a point's world position (registration / project frame) is
//! `origin + (ix − 2³¹) · scale` per axis ([`GRID_ZERO`]), with
//! `scale = 0.001` (millimetres) in every sample. The header's `root-offset`
//! is NOT that zero: it is the root node's key (the root cube's corner),
//! which only happens to be 2³¹ when the cloud's root cube starts at the
//! origin (Piazza: 2³¹; Teatro Pergolesi: 2³¹ + 3·2¹⁵). A node file
//! `/<L>/<bucket>/L<L>X<hex>Y<hex>Z<hex>.apr` covers the cube
//! `[key, key + 2^L)` in grid units — `L` is log₂ of the node edge in grid
//! units, so the root has the largest `L` (`max-lod`) and the finest leaves
//! `min-lod`. Points are not duplicated across levels: every point is stored
//! in exactly one node and coarser nodes hold a subsample of their region
//! (Σ node counts == `point-count`).

use serde::Serialize;
use serde_json::Value;

use crate::error::{fmt_err, Result};
use crate::model::Aabb;

#[derive(Clone, Debug, Serialize)]
pub struct HspcAttribute {
    pub name: String,
    pub role: String,
    pub dtype: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct HspcInfo {
    pub format_version: i64,
    pub point_count: u64,
    pub origin: [f64; 3],
    pub scale: [f64; 3],
    /// The root node's key (root cube corner, grid units) — informational;
    /// positions are relative to [`GRID_ZERO`], not to this.
    pub root_offset: [u64; 3],
    pub bounds: Aabb,
    pub min_lod: u32,
    pub max_lod: u32,
    pub node_size: u64,
    pub attributes: Vec<HspcAttribute>,
    /// `SetupIndexU8` value → setup name (the `Hds_OdbSetup.mName`).
    pub setup_lut: Vec<(u32, String)>,
    pub has_color: bool,
    #[serde(skip)]
    pub raw: Value,
}

fn arr3<T: Copy + Default>(v: &Value, f: impl Fn(&Value) -> Option<T>) -> Option<[T; 3]> {
    let a = v.as_array()?;
    if a.len() != 3 {
        return None;
    }
    Some([f(&a[0])?, f(&a[1])?, f(&a[2])?])
}

impl HspcInfo {
    pub fn parse(bytes: &[u8]) -> Result<HspcInfo> {
        let raw: Value = serde_json::from_slice(bytes)
            .map_err(|e| crate::Error::Format(format!("hspcInfo.json: {e}")))?;
        let h = &raw["tree-header-info"];
        if !h.is_object() {
            return fmt_err("hspcInfo.json has no tree-header-info");
        }
        let f3 = |k: &str| arr3(&h[k], Value::as_f64);
        let bb = &h["bounding-box"];
        let bounds = match (
            arr3(&bb["min"], Value::as_f64),
            arr3(&bb["max"], Value::as_f64),
        ) {
            (Some(min), Some(max)) => Aabb { min, max },
            _ => Aabb::EMPTY,
        };
        let attributes = h["attributes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| HspcAttribute {
                        name: x["name"].as_str().unwrap_or_default().into(),
                        role: x["role"].as_str().unwrap_or_default().into(),
                        dtype: x["type"].as_str().unwrap_or_default().into(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let meta = &h["metadata"];
        let mut setup_lut: Vec<(u32, String)> = meta["SetupLUT"]
            .as_object()
            .map(|o| {
                o.iter()
                    .filter_map(|(k, v)| Some((k.parse().ok()?, v.as_str()?.to_string())))
                    .filter(|(_, n)| n != "EndofSetupIndices")
                    .collect()
            })
            .unwrap_or_default();
        setup_lut.sort();
        let point_count = h["point-count"].as_u64().unwrap_or_else(|| {
            let hi = h["point-count-high-bits"].as_u64().unwrap_or(0);
            let lo = h["point-count-low-bits"].as_u64().unwrap_or(0);
            (hi << 32) | lo
        });
        Ok(HspcInfo {
            format_version: h["format-version"].as_i64().unwrap_or(0),
            point_count,
            origin: f3("origin").unwrap_or([0.0; 3]),
            scale: f3("scale").unwrap_or([0.001; 3]),
            root_offset: arr3(&h["root-offset"], Value::as_u64).unwrap_or([1 << 31; 3]),
            bounds,
            min_lod: h["min-lod"].as_u64().unwrap_or(0) as u32,
            max_lod: h["max-lod"].as_u64().unwrap_or(0) as u32,
            node_size: h["node-size"].as_u64().unwrap_or(0),
            attributes,
            setup_lut,
            has_color: meta["HasColor"].as_bool().unwrap_or(false),
            raw,
        })
    }

    /// Grid coordinate → project-frame position.
    pub fn to_world(&self, g: [u32; 3]) -> [f64; 3] {
        let mut p = [0.0; 3];
        for k in 0..3 {
            p[k] = self.origin[k] + (g[k] as i64 - GRID_ZERO as i64) as f64 * self.scale[k];
        }
        p
    }
}

/// Grid coordinate of the `origin` on every axis.
pub const GRID_ZERO: u64 = 1 << 31;

/// An octree node as named in the archive.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
pub struct NodeKey {
    pub level: u32,
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

impl NodeKey {
    /// Parse `…/L<level>X<hex>Y<hex>Z<hex>.apr`.
    pub fn from_path(path: &str) -> Option<NodeKey> {
        let name = path.rsplit('/').next()?.strip_suffix(".apr")?;
        let rest = name.strip_prefix('L')?;
        let xi = rest.find('X')?;
        let yi = rest.find('Y')?;
        let zi = rest.find('Z')?;
        // `get`: a name with the letters out of order is not a node
        Some(NodeKey {
            level: rest.get(..xi)?.parse().ok()?,
            x: u32::from_str_radix(rest.get(xi + 1..yi)?, 16).ok()?,
            y: u32::from_str_radix(rest.get(yi + 1..zi)?, 16).ok()?,
            z: u32::from_str_radix(rest.get(zi + 1..)?, 16).ok()?,
        })
    }

    /// Edge length in grid units.
    pub fn size(&self) -> u64 {
        1u64 << self.level
    }

    /// The parent node's key (one level up).
    pub fn parent(&self) -> NodeKey {
        let m = !((1u64 << (self.level + 1)) - 1) as u32;
        NodeKey {
            level: self.level + 1,
            x: self.x & m,
            y: self.y & m,
            z: self.z & m,
        }
    }

    pub fn bounds(&self, info: &HspcInfo) -> Aabb {
        let lo = info.to_world([self.x, self.y, self.z]);
        let s = self.size() as f64;
        Aabb {
            min: lo,
            max: [
                lo[0] + s * info.scale[0],
                lo[1] + s * info.scale[1],
                lo[2] + s * info.scale[2],
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_names() {
        assert_eq!(
            NodeKey::from_path("/15/0/L15X80018000Y80000000Z7fff8000.apr"),
            Some(NodeKey {
                level: 15,
                x: 0x8001_8000,
                y: 0x8000_0000,
                z: 0x7fff_8000,
            })
        );
        // letters out of order, missing parts, other files: not nodes
        for name in [
            "/3/0/L3Y1X2Z3.apr",
            "/3/0/L3X1Z2Y3.apr",
            "/3/0/L3Z1Y2X3.apr",
            "/3/0/LXYZ.apr",
            "/3/0/L3X1Y2.apr",
            "/hspcInfo.json",
        ] {
            assert_eq!(NodeKey::from_path(name), None, "{name}");
        }
    }
}
