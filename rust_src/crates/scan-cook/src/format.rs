//! `.tdpp` v1 binary layout — see `docs/TDPP_FORMAT.md` (the normative
//! description); this module is the single place the byte offsets live.

pub const MAGIC: &[u8; 4] = b"TDPP";
pub const VERSION: u32 = 1;
pub const HEADER_SIZE: usize = 128;
pub const NODE_RECORD_SIZE: usize = 96;
pub const PAYLOAD_HEADER_SIZE: usize = 20;
pub const CLUSTER_RECORD_SIZE: usize = 32;
/// Position stream vertex: u16 x, y, z (cluster-quantized), u16 intensity
/// (low byte 0 under `FLAG_INTENSITY8`).
pub const POS_VERTEX_SIZE: usize = 8;
/// Attribute stream vertex: u8 r, g, b, setup — or u8 r − g, g, b − g
/// (wrapping), setup in a node flagged `NODE_COLOR_DELTA`.
pub const ATTR_VERTEX_SIZE: usize = 4;
/// Normal stream vertex (optional): u16 ring code, u16 0.
pub const NORMAL_VERTEX_SIZE: usize = 4;
pub const NO_INDEX: u32 = u32::MAX;

pub const FLAG_COLOR: u32 = 1;
pub const FLAG_INTENSITY: u32 = 2;
pub const FLAG_SETUP: u32 = 4;
pub const FLAG_NORMALS: u32 = 8;
/// Intensity holds 8 significant bits: the stored u16's low byte is 0.
pub const FLAG_INTENSITY8: u32 = 16;

/// Node flag: the attribute stream stores r − g, g, b − g (wrapping u8) —
/// the channels of a scan are close to each other, the differences compress
/// better.
pub const NODE_COLOR_DELTA: u8 = 1;

#[derive(Clone, Debug, Default)]
pub struct Header {
    pub file_size: u64,
    pub hierarchy_offset: u64,
    pub node_count: u32,
    pub cluster_size: u32,
    pub meta_offset: u64,
    pub meta_size: u64,
    pub point_count: u64,
    /// World (source frame) position of local coordinate (0, 0, 0).
    pub origin: [f64; 3],
    /// Tight bounds of all points, relative to `origin`.
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
    pub flags: u32,
    pub setup_count: u32,
}

impl Header {
    pub fn to_bytes(&self) -> [u8; HEADER_SIZE] {
        let mut b = [0u8; HEADER_SIZE];
        let mut w = W(&mut b, 0);
        w.bytes(MAGIC);
        w.u32(VERSION);
        w.u32(HEADER_SIZE as u32);
        w.u32(NODE_RECORD_SIZE as u32);
        w.u64(self.file_size);
        w.u64(self.hierarchy_offset);
        w.u32(self.node_count);
        w.u32(self.cluster_size);
        w.u64(self.meta_offset);
        w.u64(self.meta_size);
        w.u64(self.point_count);
        for v in self.origin {
            w.f64(v);
        }
        for v in self.bounds_min.iter().chain(&self.bounds_max) {
            w.f32(*v);
        }
        w.u32(self.flags);
        w.u32(self.setup_count);
        debug_assert_eq!(w.1, 120);
        b
    }

    pub fn parse(b: &[u8]) -> Result<Header, String> {
        if b.len() < HEADER_SIZE || &b[..4] != MAGIC {
            return Err("not a .tdpp file".into());
        }
        let mut r = R(b, 4);
        let version = r.u32();
        if version != VERSION {
            return Err(format!(
                ".tdpp version {version} (reader supports {VERSION})"
            ));
        }
        let (hs, nrs) = (r.u32(), r.u32());
        if hs as usize != HEADER_SIZE || nrs as usize != NODE_RECORD_SIZE {
            return Err(".tdpp header/record size mismatch".into());
        }
        Ok(Header {
            file_size: r.u64(),
            hierarchy_offset: r.u64(),
            node_count: r.u32(),
            cluster_size: r.u32(),
            meta_offset: r.u64(),
            meta_size: r.u64(),
            point_count: r.u64(),
            origin: [r.f64(), r.f64(), r.f64()],
            bounds_min: [r.f32(), r.f32(), r.f32()],
            bounds_max: [r.f32(), r.f32(), r.f32()],
            flags: r.u32(),
            setup_count: r.u32(),
        })
    }
}

/// One hierarchy entry (96 bytes; 84 used, 12 reserved). Nodes are stored breadth-first: the root
/// is node 0, a node's children are contiguous and ordered by octant
/// (`x | y << 1 | z << 2`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NodeRecord {
    /// Node cube corner, relative to the header origin.
    pub cube_min: [f32; 3],
    pub cube_size: f32,
    /// Tight bounds of this node's own points (relative to origin).
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
    /// Point spacing (m) of this node's points, measured from the surface
    /// they cover (`node::measured_spacing`) — the LOD metric.
    pub spacing: f32,
    pub point_count: u32,
    pub parent: u32,
    pub first_child: u32,
    pub child_count: u8,
    pub depth: u8,
    /// Octant of this node within its parent (0..8; 0 for the root).
    pub octant: u8,
    /// `NODE_*` bits.
    pub flags: u8,
    pub cluster_count: u32,
    pub payload_size: u32,
    pub payload_offset: u64,
    /// Bit `s` set when setup `s` has points in this node (bit 63: s ≥ 63).
    pub setup_mask: u64,
}

impl NodeRecord {
    pub fn write(&self, out: &mut Vec<u8>) {
        let mut b = [0u8; NODE_RECORD_SIZE];
        let mut w = W(&mut b, 0);
        for v in self.cube_min {
            w.f32(v);
        }
        w.f32(self.cube_size);
        for v in self.bounds_min.iter().chain(&self.bounds_max) {
            w.f32(*v);
        }
        w.f32(self.spacing);
        w.u32(self.point_count);
        w.u32(self.parent);
        w.u32(self.first_child);
        w.u8(self.child_count);
        w.u8(self.depth);
        w.u8(self.octant);
        w.u8(self.flags);
        w.u32(self.cluster_count);
        w.u32(self.payload_size);
        w.u64(self.payload_offset);
        w.u64(self.setup_mask);
        debug_assert_eq!(w.1, 84);
        out.extend_from_slice(&b);
    }

    pub fn parse(b: &[u8]) -> NodeRecord {
        let mut r = R(b, 0);
        let cube_min = [r.f32(), r.f32(), r.f32()];
        let cube_size = r.f32();
        let bounds_min = [r.f32(), r.f32(), r.f32()];
        let bounds_max = [r.f32(), r.f32(), r.f32()];
        let spacing = r.f32();
        let point_count = r.u32();
        let parent = r.u32();
        let first_child = r.u32();
        let child_count = r.u8();
        let depth = r.u8();
        let octant = r.u8();
        let flags = r.u8();
        NodeRecord {
            cube_min,
            cube_size,
            bounds_min,
            bounds_max,
            spacing,
            point_count,
            parent,
            first_child,
            child_count,
            depth,
            octant,
            flags,
            cluster_count: r.u32(),
            payload_size: r.u32(),
            payload_offset: r.u64(),
            setup_mask: r.u64(),
        }
    }
}

/// Per-cluster quantization box inside a node payload (32 bytes).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClusterRecord {
    /// Cluster corner relative to the node's `cube_min`.
    pub min: [f32; 3],
    /// Quantization step per axis: `p = cube_min + min + q · step`.
    pub step: [f32; 3],
    pub first: u32,
    pub count: u32,
}

pub(crate) struct W<'a>(pub &'a mut [u8], pub usize);
impl W<'_> {
    pub fn bytes(&mut self, v: &[u8]) {
        self.0[self.1..self.1 + v.len()].copy_from_slice(v);
        self.1 += v.len();
    }
    pub fn u8(&mut self, v: u8) {
        self.bytes(&[v]);
    }
    pub fn u32(&mut self, v: u32) {
        self.bytes(&v.to_le_bytes());
    }
    pub fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
    pub fn f32(&mut self, v: f32) {
        self.bytes(&v.to_le_bytes());
    }
    pub fn f64(&mut self, v: f64) {
        self.bytes(&v.to_le_bytes());
    }
}

pub(crate) struct R<'a>(pub &'a [u8], pub usize);
impl R<'_> {
    fn take<const N: usize>(&mut self) -> [u8; N] {
        let v = self.0[self.1..self.1 + N].try_into().unwrap();
        self.1 += N;
        v
    }
    pub fn u8(&mut self) -> u8 {
        self.take::<1>()[0]
    }
    pub fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take())
    }
    pub fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.take())
    }
    pub fn f32(&mut self) -> f32 {
        f32::from_le_bytes(self.take())
    }
    pub fn f64(&mut self) -> f64 {
        f64::from_le_bytes(self.take())
    }
}
