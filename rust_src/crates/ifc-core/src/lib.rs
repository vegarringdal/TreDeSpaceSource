//! ifc2glb core: IFC (building model) → GLB conversion.
//!
//! The IFC front end is `ifc_lite_processing` (parse → geometry → colour → void
//! subtraction → placement, plus the spatial tree). This crate maps the resulting
//! world-space meshes into our own [`Mesh`] model and groups them into output files by
//! spatial tier. The wasm (ifc-wasm) cooks each straight to `.tdp` through
//! cooker-core; the GLB writer here serves the CLI and debugging. See DESIGN.md ›
//! "Import converters".

pub mod convert;
pub mod glb;
pub mod mesh;
pub mod relations;
pub mod split;
pub mod status;

pub use convert::{
    ConvertOptions, ConvertOutput, ConvertReport, Openings, OutputFile, OutputMode, Quality,
    Spaces, convert, convert_cooked, convert_with_progress, CookHook,
};
pub use mesh::Mesh;
pub use split::SplitTier;
