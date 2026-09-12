//! GLB → cooked `.model` (CADM v7) pipeline. See rust_src/PLAN.md.
//!
//! Byte-compatible port of the reference cooker (vulkan_reference/crates/
//! cad-cooker + cad-format via the vendored crate). Library only: the wasm
//! wrapper (cooker-wasm) and a future CLI wrap this.

pub mod cook;
pub mod flat;
pub mod glb;
pub mod tdp;

pub use cook::{
    cook, cook_both, cook_model, cook_model_both, cook_model_both_with_progress,
    cook_model_with_progress, merged_model_from_glb, CoarsenOptions, CookOptions, CookOutput,
    CookProgress, MergedHierarchyEntry, MergedModel, MergedNode, MergedRange,
};
pub use flat::model_from_flat;
pub use tdp::{coarsen_tdp, coarsen_tdp_with_progress};

/// Bumped whenever the cooked output changes — part of the cache key, so stale
/// cooked files re-cook automatically (same rule as the reference cooker).
/// v3: coarsen tiny-item cut threshold uses the dense diagonal (outlier fix).
pub const COOKER_VERSION: u32 = 3;
