//! LGSX → `.tdpp`: the HSPC octree already has the right shape (additive
//! LOD, no duplicates), so every node is decoded and re-encoded in place.
//! Positions stay on the 1 mm HSPC grid and round-trip exactly.

use scan_core::lgsx::cube::ImageSpan;
use scan_core::lgsx::{CubeKind, Lgsx, Setup};
use serde_json::json;

use crate::bytes::{In, Out};
use crate::format::{Header, FLAG_COLOR, FLAG_INTENSITY, FLAG_NORMALS, FLAG_SETUP};
use crate::node::{self, Cube, Encoded, Grid, NodeKey, Pt};
use crate::writer::Writer;
use crate::{base_meta, pano_json, par_map, skipped_note, CookOptions, Result};

/// Mapping between the LGSX grid and the cook grid.
pub struct LgsxFrame {
    pub grid: Grid,
    /// LGSX grid value of cook-grid 0 (per axis).
    pub zero: [i64; 3],
    pub root: Cube,
    pub root_level: u32,
    pub root_key: [u32; 3],
}

impl LgsxFrame {
    pub fn new(l: &Lgsx) -> Result<LgsxFrame> {
        let info = &l.info;
        let s = info.scale[0];
        if info.scale.iter().any(|&v| (v - s).abs() > 1e-12) {
            return Err("LGSX with a non-uniform grid scale".into());
        }
        // The top level usually holds one node. A cloud that straddles a
        // power-of-two boundary of the LGSX grid (one centred on the grid
        // origin has 8 top nodes around it) gets an empty root cube laid
        // over its top nodes: the cook's octree only needs every node to be
        // a child cell of its parent, not to sit on the LGSX key lattice.
        let top = l.nodes.first().ok_or("LGSX without octree nodes")?.key;
        let mut lo = [u32::MAX; 3];
        let mut hi = [0u32; 3];
        for n in l.nodes.iter().filter(|n| n.key.level == top.level) {
            for (k, v) in [n.key.x, n.key.y, n.key.z].into_iter().enumerate() {
                lo[k] = lo[k].min(v);
                hi[k] = hi[k].max(v);
            }
        }
        let cells = (0..3)
            .map(|k| ((hi[k] - lo[k]) >> top.level) as u64 + 1)
            .max()
            .unwrap_or(1);
        let root_level = top.level + cells.next_power_of_two().trailing_zeros();
        if root_level > 40 {
            return Err("LGSX top-level nodes are too far apart".into());
        }
        // cook-grid 0 = centre of the bounds, snapped to the LGSX grid
        let mut zero = [0i64; 3];
        let mut origin = [0.0; 3];
        for k in 0..3 {
            let c = 0.5 * (info.bounds.min[k] + info.bounds.max[k]);
            let steps = ((c - info.origin[k]) / s).round() as i64;
            zero[k] = scan_core::lgsx::hspc::GRID_ZERO as i64 + steps;
            origin[k] = info.origin[k] + steps as f64 * s;
        }
        let rk = lo;
        let root_cube = Cube {
            min: [
                rk[0] as i64 - zero[0],
                rk[1] as i64 - zero[1],
                rk[2] as i64 - zero[2],
            ],
            size: 1i64 << root_level,
        };
        Ok(LgsxFrame {
            grid: Grid { origin, scale: s },
            zero,
            root: root_cube,
            root_level,
            root_key: rk,
        })
    }

    pub fn key(&self, k: &scan_core::lgsx::hspc::NodeKey) -> Result<NodeKey> {
        if k.level > self.root_level {
            return Err(format!("node {k:?} above the root").into());
        }
        let d = self.root_level - k.level;
        let rel = |v: u32, r: u32| -> Result<u32> {
            v.checked_sub(r)
                .map(|x| x >> k.level)
                .ok_or_else(|| format!("node {k:?} outside the root").into())
        };
        let nk = NodeKey {
            depth: d as u8,
            x: rel(k.x, self.root_key[0])?,
            y: rel(k.y, self.root_key[1])?,
            z: rel(k.z, self.root_key[2])?,
        };
        if [nk.x, nk.y, nk.z].iter().any(|&v| v >= 1 << d) {
            return Err(format!("node {k:?} outside the root").into());
        }
        Ok(nk)
    }

    pub fn to_pt(&self, g: [u32; 3]) -> [i32; 3] {
        [
            (g[0] as i64 - self.zero[0]) as i32,
            (g[1] as i64 - self.zero[1]) as i32,
            (g[2] as i64 - self.zero[2]) as i32,
        ]
    }
}

/// Nodes handed to the encoder per step (and per sub-worker call).
pub const NODE_STEP: usize = 8;

/// A run of encoded nodes and the attributes seen in them.
pub struct NodesOut {
    pub nodes: Vec<Encoded>,
    pub has_color: bool,
    pub has_intensity: bool,
    pub has_setup: bool,
    /// A normal stream was written (the option is on and the source has
    /// normals).
    pub has_normals: bool,
}

impl NodesOut {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Out::default();
        out.u8(self.has_color as u8
            | (self.has_intensity as u8) << 1
            | (self.has_setup as u8) << 2
            | (self.has_normals as u8) << 3);
        out.u32(self.nodes.len() as u32);
        for n in &self.nodes {
            out.node(n);
        }
        out.0
    }

    pub fn from_bytes(b: &[u8]) -> Result<NodesOut> {
        let mut r = In(b);
        let f = r.u8()?;
        let mut nodes = Vec::new();
        for _ in 0..r.u32()? {
            nodes.push(r.node()?);
        }
        Ok(NodesOut {
            nodes,
            has_color: f & 1 != 0,
            has_intensity: f & 2 != 0,
            has_setup: f & 4 != 0,
            has_normals: f & 8 != 0,
        })
    }
}

/// Decode and re-encode the octree nodes `range` (file order), each on its
/// own — threads natively, one sub-worker call in the browser.
pub fn encode_nodes(
    l: &Lgsx,
    fr: &LgsxFrame,
    o: &CookOptions,
    range: std::ops::Range<usize>,
    threads: usize,
) -> Result<NodesOut> {
    let enc = o.encode();
    let nodes: Vec<_> = l
        .nodes
        .get(range)
        .ok_or("node range out of bounds")?
        .iter()
        .collect();
    let done = par_map(nodes, threads, |n| {
        let p = l.read_node(n)?;
        let key = fr.key(&n.key)?;
        let cube = key.cube(&fr.root);
        let rgb = p.rgb.as_deref();
        let it = p.intensity.as_deref();
        let su = p.setup.as_deref();
        let nc = if o.normals {
            p.normal_code.as_deref()
        } else {
            None
        };
        let pts: Vec<Pt> = (0..p.len())
            .map(|i| Pt {
                g: fr.to_pt(p.grid[i]),
                rgb: rgb.map_or([255; 3], |c| c[i]),
                setup: su.map_or(0, |s| s[i]),
                intensity: it.map_or(0, |v| v[i]),
                n: nc.map_or(node::NO_NORMAL, |c| c[i]),
            })
            .collect();
        // a normal stream only where there are normals: a source without
        // them gets none (and no header flag), not a stream of "no normal"
        let enc = node::EncodeOptions {
            normals: nc.is_some(),
            ..enc
        };
        Ok((
            node::encode(key, cube, &pts, &fr.grid, &enc),
            (rgb.is_some(), it.is_some(), su.is_some(), nc.is_some()),
        ))
    })?;
    let mut out = NodesOut {
        nodes: Vec::with_capacity(done.len()),
        has_color: false,
        has_intensity: false,
        has_setup: false,
        has_normals: false,
    };
    for (e, (c, i, s, n)) in done {
        out.nodes.push(e);
        out.has_color |= c;
        out.has_intensity |= i;
        out.has_setup |= s;
        out.has_normals |= n;
    }
    Ok(out)
}

/// The coordinator's state: the output and the attributes seen so far.
pub struct Assembly {
    w: Writer,
    has_color: bool,
    has_intensity: bool,
    has_setup: bool,
    has_normals: bool,
}

impl Assembly {
    pub fn new(out: Box<dyn crate::writer::Sink>) -> Result<Assembly> {
        Ok(Assembly {
            w: Writer::new(out)?,
            has_color: false,
            has_intensity: false,
            has_setup: false,
            has_normals: false,
        })
    }

    /// Write a run of nodes. Runs must arrive in node order — the node
    /// order in the file follows it.
    pub fn add_nodes(&mut self, run: NodesOut) -> Result<()> {
        self.has_color |= run.has_color;
        self.has_intensity |= run.has_intensity;
        self.has_setup |= run.has_setup;
        self.has_normals |= run.has_normals;
        for n in run.nodes {
            self.w.add_node(n)?;
        }
        Ok(())
    }
}

pub fn cook(
    l: &Lgsx,
    out: Box<dyn crate::writer::Sink>,
    o: &CookOptions,
    log: &(dyn Fn(&str) + Sync),
) -> Result<Header> {
    let t0 = crate::Clock::start();
    let fr = LgsxFrame::new(l)?;
    let mut asm = Assembly::new(out)?;
    let total = l.nodes.len();
    // a run per thread at a time keeps the encoded nodes in memory small
    let step = NODE_STEP * o.threads.max(1);
    let mut at = 0;
    while at < total {
        let end = (at + step).min(total);
        asm.add_nodes(encode_nodes(l, &fr, o, at..end, o.threads)?)?;
        if end / 500 != at / 500 || end == total {
            log(&format!("nodes {end}/{total} ({:.0}s)", t0.secs()));
        }
        at = end;
    }
    finish(l, &fr, asm, o, log, t0)
}

/// One mip level of a cube face, read.
type Level = (ImageSpan, Vec<u8>);

/// A setup's camera cube with every level the cook keeps read into memory
/// (per face, largest first); `None` for a setup without one.
fn read_pano(l: &Lgsx, s: &Setup, max_size: u32) -> scan_core::Result<Option<Vec<Vec<Level>>>> {
    let Some(sec) = l.cube_section(s, CubeKind::Camera) else {
        return Ok(None);
    };
    let cube = l.cube(sec)?;
    let mut faces = Vec::with_capacity(cube.faces.len());
    for chain in &cube.faces {
        let mut levels = Vec::new();
        for img in chain
            .iter()
            .filter(|i| i.width <= max_size && i.height <= max_size)
        {
            levels.push((*img, l.read_image(sec, img)?));
        }
        faces.push(levels);
    }
    Ok(Some(faces))
}

/// The setups, their panoramas, the metadata and the header.
pub fn finish(
    l: &Lgsx,
    fr: &LgsxFrame,
    asm: Assembly,
    o: &CookOptions,
    log: &(dyn Fn(&str) + Sync),
    t0: crate::Clock,
) -> Result<Header> {
    let Assembly {
        mut w,
        has_color,
        has_intensity: has_int,
        has_setup,
        has_normals,
    } = asm;

    // The file is written in the project's active coordinate system — the
    // coordinates the Leica software shows and exports. The points keep
    // their grid (axes of the project frame); the header origin and the
    // setup poses are moved, and a rotation from the grid axes to those
    // coordinates goes into the metadata when there is one.
    let active = if o.project_frame {
        None
    } else {
        l.coord_system()
    };
    let world = active.map_or(scan_core::model::Pose::IDENTITY, |c| c.pose.inverse());
    if let Some(c) = active {
        log(&format!("Coordinate system: {}", c.name));
    }

    // setups + camera cube panoramas
    let mut setups = Vec::new();
    // a panorama that cannot be read is left out: the points are worth more
    // than a cook that fails at its last step
    let mut skipped = 0usize;
    for s in &l.setups {
        let mut pano = serde_json::Value::Null;
        if o.pano_max_size > 0 {
            // read whole before any of it is written, so a cube is in the
            // file complete or not at all
            match read_pano(l, s, o.pano_max_size) {
                Ok(Some(read)) => {
                    let mut faces = Vec::new();
                    for chain in read {
                        let mut levels = Vec::new();
                        for (img, bytes) in chain {
                            let b = w.add_blob(&bytes)?;
                            levels.push((img.width, img.height, img.format.extension(), b));
                        }
                        faces.push(levels);
                    }
                    pano = pano_json(faces);
                }
                Ok(None) => {}
                Err(err) => {
                    skipped += 1;
                    log(&format!(
                        "warning: panorama of setup {} left out: {err}",
                        s.name
                    ));
                }
            }
        }
        setups.push(json!({
            "index": s.point_index,
            "name": s.name,
            "label": s.label,
            "guid": s.guid,
            "resource_id": s.resource_id,
            "pose": world.compose(&s.pose),
            "panorama": pano,
        }));
    }
    let mut meta = base_meta(
        json!({ "format": "lgsx", "writer": l.container.writer_version, "point_count": l.info.point_count }),
        o,
    );
    meta.insert(
        "frame".into(),
        match active {
            Some(c) => format!(
                "LGSX coordinate system \"{}\" (setup poses map setup → this frame)",
                c.name
            ),
            None => "LGSX project frame (setup poses map setup → this frame)".to_string(),
        }
        .into(),
    );
    if world.rotation != scan_core::model::Pose::IDENTITY.rotation {
        meta.insert("rotation".into(), json!(world.rotation));
    }
    meta.insert(
        "coordinate_systems".into(),
        json!(l
            .coord_systems
            .iter()
            .map(|c| {
                json!({
                    "name": c.name,
                    "active": c.active,
                    "control": c.control,
                    // the one this file's origin, rotation and setup poses are in
                    "used": active.is_some_and(|a| a.db_id == c.db_id),
                    "pose": c.pose,
                })
            })
            .collect::<Vec<_>>()),
    );
    // what the source says about coordinates, applied or not — shown at
    // import so a scan that lands in the wrong place can be diagnosed
    let mut report = vec![
        format!(
            "Writer: {}",
            l.container.writer_version.as_deref().unwrap_or("unknown")
        ),
        format!(
            "PointCloud: origin={:?} bounds={:?}..{:?} scale={:?}",
            l.info.origin, l.info.bounds.min, l.info.bounds.max, l.info.scale
        ),
    ];
    report.extend(l.coord_report.iter().cloned());
    meta.insert("coordinate_report".into(), json!(report));
    meta.insert("grid_scale".into(), fr.grid.scale.into());
    meta.insert("setups".into(), setups.into());
    let flags = if has_color { FLAG_COLOR } else { 0 }
        | if has_int { FLAG_INTENSITY } else { 0 }
        | if has_setup { FLAG_SETUP } else { 0 }
        | if has_normals { FLAG_NORMALS } else { 0 }
        | if has_int && !o.intensity16 {
            crate::format::FLAG_INTENSITY8
        } else {
            0
        };
    let grid = crate::node::Grid {
        origin: world.apply(fr.grid.origin),
        scale: fr.grid.scale,
    };
    let h = w.finish(
        fr.root,
        &grid,
        o.cluster_size,
        flags,
        l.setups.len() as u32,
        &serde_json::Value::Object(meta),
    )?;
    log(&format!(
        "done: {} nodes, {} points, {:.0}s{}",
        h.node_count,
        h.point_count,
        t0.secs(),
        skipped_note(skipped)
    ));
    // a header without a point count reads as 0: nothing to compare with
    if l.info.point_count != 0 && h.point_count != l.info.point_count {
        return Err(format!(
            "wrote {} points, LGSX declares {}",
            h.point_count, l.info.point_count
        )
        .into());
    }
    Ok(h)
}
