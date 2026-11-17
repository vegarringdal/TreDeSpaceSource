//! The engine's internal mesh model: one triangulated, world-space element ready for the
//! GLB writer. Decoupled from `ifc_lite_processing::MeshData` so the writer is testable
//! with synthetic meshes and unaffected by upstream field churn.

/// A decoded surface texture (RGBA8), carried by textured meshes.
#[derive(Debug, Clone)]
pub struct MeshTexture {
    /// `width * height * 4` bytes, row-major, top-down, straight alpha.
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Sampler wrap (from `IfcSurfaceTexture.RepeatS/RepeatT`).
    pub repeat_s: bool,
    pub repeat_t: bool,
}

/// One IFC element's geometry, in **world space, IFC Z-up, metres**.
#[derive(Debug, Clone)]
pub struct Mesh {
    /// IFC STEP/express id of the source element.
    pub express_id: u32,
    /// IFC type name, e.g. `"IfcWall"`.
    pub ifc_type: String,
    /// IFC `Name`, when present.
    pub name: Option<String>,
    /// Flat world-space positions `[x,y,z, ...]`.
    pub positions: Vec<f32>,
    /// Flat normals `[nx,ny,nz, ...]`, 1:1 with `positions`.
    pub normals: Vec<f32>,
    /// Triangle indices into the vertex arrays.
    pub indices: Vec<u32>,
    /// Linear RGBA in 0..=1.
    pub color: [f32; 4],
    /// Per-vertex `[u,v, ...]` (1:1 with `positions`), present only for textured meshes.
    pub uvs: Option<Vec<f32>>,
    /// Decoded surface texture, present only for textured meshes.
    pub texture: Option<MeshTexture>,
}

/// One occurrence of a shared (instanced) shape.
#[derive(Debug, Clone)]
pub struct Instance {
    /// Occurrence element express id.
    pub express_id: u32,
    /// IFC type name.
    pub ifc_type: String,
    /// IFC `Name`, when present.
    pub name: Option<String>,
    /// Express id of the template [`Mesh`] this occurrence instantiates.
    pub template_express_id: u32,
    /// Row-major, template-relative mat4: applied to the template's world geometry
    /// (`origin + positions`) it yields this occurrence's world geometry.
    pub transform: [f32; 16],
}

impl Instance {
    /// A display label for the glTF node.
    pub fn label(&self) -> String {
        match &self.name {
            Some(n) if !n.is_empty() => format!("{n} ({}#{})", self.ifc_type, self.express_id),
            _ => format!("{}#{}", self.ifc_type, self.express_id),
        }
    }
}

impl Mesh {
    /// A display label for the glTF node: `"<Name> (IfcType#id)"` or `"IfcType#id"`.
    pub fn label(&self) -> String {
        match &self.name {
            Some(n) if !n.is_empty() => format!("{n} ({}#{})", self.ifc_type, self.express_id),
            _ => format!("{}#{}", self.ifc_type, self.express_id),
        }
    }
}
