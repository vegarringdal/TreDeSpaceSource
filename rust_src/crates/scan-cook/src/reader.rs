//! `.tdpp` reader (verification, tools; the viewer has its own TS reader).

use scan_core::source::Source;

use crate::format::*;
use crate::node::{self, Decoded, NodeKey};
use crate::Result;

pub struct Tdpp {
    src: Source,
    pub header: Header,
    pub nodes: Vec<NodeRecord>,
    /// Octree key of each node (derived from parent + octant).
    pub keys: Vec<NodeKey>,
    pub meta: serde_json::Value,
}

impl Tdpp {
    pub fn open(src: Source) -> Result<Tdpp> {
        let header = Header::parse(&src.read_vec(0, HEADER_SIZE)?)?;
        if header.file_size != src.len() {
            return Err(format!(
                "header says {} bytes, file has {}",
                header.file_size,
                src.len()
            )
            .into());
        }
        let n = header.node_count as usize;
        let h = src.read_vec(header.hierarchy_offset, n * NODE_RECORD_SIZE)?;
        let nodes: Vec<NodeRecord> = h.chunks(NODE_RECORD_SIZE).map(NodeRecord::parse).collect();
        let mut keys = vec![NodeKey::ROOT; n];
        for (i, r) in nodes.iter().enumerate().skip(1) {
            let p = r.parent as usize;
            if p >= i {
                return Err("hierarchy is not breadth-first".into());
            }
            keys[i] = keys[p].child(r.octant as usize);
        }
        let meta =
            serde_json::from_slice(&src.read_vec(header.meta_offset, header.meta_size as usize)?)?;
        Ok(Tdpp {
            src,
            header,
            nodes,
            keys,
            meta,
        })
    }

    pub fn payload(&self, i: usize) -> Result<Vec<u8>> {
        let r = &self.nodes[i];
        Ok(self
            .src
            .read_vec(r.payload_offset, r.payload_size as usize)?)
    }

    pub fn decode(&self, i: usize) -> Result<Decoded> {
        let r = &self.nodes[i];
        if r.point_count == 0 {
            return Ok(Decoded::default());
        }
        Ok(node::decode(r, &self.payload(i)?)?)
    }

    pub fn read_blob(&self, offset: u64, size: u64) -> Result<Vec<u8>> {
        Ok(self.src.read_vec(offset, size as usize)?)
    }
}
