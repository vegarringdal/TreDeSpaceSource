//! GLB → cooked `.model` (CADM v7) pipeline. See rust_src/PLAN.md.
//!
//! Byte-compatible port of the reference cooker (vulkan_reference/crates/
//! cad-cooker + cad-format via the vendored crate). Library only: the wasm
//! wrapper (cooker-wasm) and a future CLI wrap this.

pub mod cook;
pub mod glb;
pub mod tdp;

pub use cook::{
    cook, cook_model, CoarsenOptions, CookOptions, CookOutput, MergedHierarchyEntry, MergedModel,
    MergedNode, MergedRange,
};
pub use tdp::coarsen_tdp;

/// Bumped whenever the cooked output changes — part of the cache key, so stale
/// cooked files re-cook automatically (same rule as the reference cooker).
/// v3: coarsen tiny-item cut threshold uses the dense diagonal (outlier fix).
pub const COOKER_VERSION: u32 = 3;
