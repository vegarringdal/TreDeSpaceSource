//! step2glb — low-memory STEP (ISO 10303-21) parsing, assembly-hierarchy
//! extraction, tessellation and GLB export.
//!
//! The binary (`main.rs`) is a thin CLI over this library, so the pipeline
//! can also be embedded and unit/integration tested.

pub mod convert;
pub mod csg;
pub mod geom;
pub mod glb;
pub mod hierarchy;
pub mod io;
pub mod merge;
pub mod mesh;
pub mod model;
pub mod step;
pub mod styles;
pub mod tessellate;
