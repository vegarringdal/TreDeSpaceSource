//! Streaming `.tdpp` writer: payloads and blobs are appended as they come
//! (any order, any thread via the caller); the breadth-first hierarchy, the
//! JSON metadata and the header are written by [`Writer::finish`].

use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::io::Write;

use crate::format::*;
use crate::node::{Cube, Encoded, Grid, NodeKey};

/// Where the bytes go: sequential appends plus one patch of the header at
/// offset 0 when the file is finished.
pub trait Sink {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()>;
    fn write_at(&mut self, offset: u64, bytes: &[u8]) -> std::io::Result<()>;
    fn flush(&mut self) -> std::io::Result<()>;
}

/// A file on disk.
#[cfg(not(target_arch = "wasm32"))]
pub struct FileSink(std::io::BufWriter<std::fs::File>);

#[cfg(not(target_arch = "wasm32"))]
impl FileSink {
    pub fn create(path: &std::path::Path) -> std::io::Result<FileSink> {
        Ok(FileSink(std::io::BufWriter::with_capacity(
            8 << 20,
            std::fs::File::create(path)?,
        )))
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Sink for FileSink {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        self.0.write_all(bytes)
    }
    fn write_at(&mut self, offset: u64, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::{Seek, SeekFrom};
        self.0.flush()?;
        let f = self.0.get_mut();
        let back = f.stream_position()?;
        f.seek(SeekFrom::Start(offset))?;
        f.write_all(bytes)?;
        f.seek(SeekFrom::Start(back))?;
        Ok(())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

pub struct Writer {
    w: Box<dyn Sink>,
    pos: u64,
    nodes: HashMap<NodeKey, NodeRecord>,
    pub point_count: u64,
    lo: [f32; 3],
    hi: [f32; 3],
}

/// A blob reference for the metadata.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct BlobRef {
    pub offset: u64,
    pub size: u64,
}

impl Writer {
    #[cfg(not(target_arch = "wasm32"))]
    pub fn create(path: &std::path::Path) -> std::io::Result<Writer> {
        Writer::new(Box::new(FileSink::create(path)?))
    }

    pub fn new(mut w: Box<dyn Sink>) -> std::io::Result<Writer> {
        w.write_all(&[0u8; HEADER_SIZE])?;
        Ok(Writer {
            w,
            pos: HEADER_SIZE as u64,
            nodes: HashMap::new(),
            point_count: 0,
            lo: [f32::MAX; 3],
            hi: [f32::MIN; 3],
        })
    }

    fn align8(&mut self) -> std::io::Result<()> {
        let pad = (8 - self.pos % 8) % 8;
        self.w.write_all(&[0u8; 8][..pad as usize])?;
        self.pos += pad;
        Ok(())
    }

    pub fn add_node(&mut self, e: Encoded) -> std::io::Result<()> {
        if e.record.point_count == 0 {
            return Ok(());
        }
        self.align8()?;
        let mut rec = e.record;
        rec.payload_offset = self.pos;
        self.w.write_all(&e.payload)?;
        self.pos += e.payload.len() as u64;
        self.point_count += rec.point_count as u64;
        for k in 0..3 {
            self.lo[k] = self.lo[k].min(rec.bounds_min[k]);
            self.hi[k] = self.hi[k].max(rec.bounds_max[k]);
        }
        if self.nodes.insert(e.key, rec).is_some() {
            return Err(std::io::Error::other(format!(
                "node {:?} written twice",
                e.key
            )));
        }
        Ok(())
    }

    pub fn add_blob(&mut self, bytes: &[u8]) -> std::io::Result<BlobRef> {
        self.align8()?;
        let r = BlobRef {
            offset: self.pos,
            size: bytes.len() as u64,
        };
        self.w.write_all(bytes)?;
        self.pos += bytes.len() as u64;
        Ok(r)
    }

    /// Write hierarchy + metadata + header. `root` / `grid` describe the
    /// octree (empty ancestors of written nodes are created here).
    pub fn finish(
        mut self,
        root: Cube,
        grid: &Grid,
        cluster_size: usize,
        flags: u32,
        setup_count: u32,
        meta: &serde_json::Value,
    ) -> std::io::Result<Header> {
        // structural gaps: every ancestor of a node exists
        let keys: Vec<NodeKey> = self.nodes.keys().copied().collect();
        for k in keys {
            let mut cur = k;
            while let Some(p) = cur.parent() {
                if self.nodes.contains_key(&p) {
                    break;
                }
                let c = p.cube(&root);
                let s = grid.scale;
                let cs = (c.size as f64 * s) as f32;
                self.nodes.insert(
                    p,
                    NodeRecord {
                        cube_min: [
                            (c.min[0] as f64 * s) as f32,
                            (c.min[1] as f64 * s) as f32,
                            (c.min[2] as f64 * s) as f32,
                        ],
                        cube_size: cs,
                        spacing: cs,
                        depth: p.depth,
                        octant: p.octant() as u8,
                        ..Default::default()
                    },
                );
                cur = p;
            }
        }
        if self.nodes.is_empty() {
            return Err(std::io::Error::other("no points"));
        }
        // breadth-first order, children contiguous by octant
        let mut order: Vec<NodeKey> = vec![NodeKey::ROOT];
        let mut index: HashMap<NodeKey, u32> = HashMap::from([(NodeKey::ROOT, 0)]);
        let mut recs: Vec<NodeRecord> = vec![self.nodes.remove(&NodeKey::ROOT).unwrap_or_default()];
        recs[0].parent = NO_INDEX;
        let mut i = 0;
        while i < order.len() {
            let k = order[i];
            let first = order.len() as u32;
            let mut cnt = 0u8;
            for oct in 0..8 {
                let c = k.child(oct);
                if let Some(mut r) = self.nodes.remove(&c) {
                    r.parent = i as u32;
                    index.insert(c, order.len() as u32);
                    order.push(c);
                    recs.push(r);
                    cnt += 1;
                }
            }
            recs[i].first_child = if cnt > 0 { first } else { 0 };
            recs[i].child_count = cnt;
            i += 1;
        }
        if !self.nodes.is_empty() {
            return Err(std::io::Error::other(format!(
                "{} nodes unreachable from the root",
                self.nodes.len()
            )));
        }
        self.align8()?;
        let hierarchy_offset = self.pos;
        let mut h = Vec::with_capacity(recs.len() * NODE_RECORD_SIZE);
        for r in &recs {
            r.write(&mut h);
        }
        self.w.write_all(&h)?;
        self.pos += h.len() as u64;
        let meta_bytes = serde_json::to_vec_pretty(meta).map_err(std::io::Error::other)?;
        let meta_offset = self.pos;
        self.w.write_all(&meta_bytes)?;
        self.pos += meta_bytes.len() as u64;

        let header = Header {
            file_size: self.pos,
            hierarchy_offset,
            node_count: recs.len() as u32,
            cluster_size: cluster_size as u32,
            meta_offset,
            meta_size: meta_bytes.len() as u64,
            point_count: self.point_count,
            origin: grid.origin,
            bounds_min: self.lo,
            bounds_max: self.hi,
            flags,
            setup_count,
        };
        self.w.write_at(0, &header.to_bytes())?;
        self.w.flush()?;
        Ok(header)
    }
}
