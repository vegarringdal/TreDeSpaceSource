//! nwd-core — read Autodesk Navisworks NWD files and emit GLB.
//!
//! The pipeline mirrors the file's own layering:
//!
//! 1. [`container`] cracks the `LcUStream` wrapper into inflated chunks.
//! 2. [`inspect`] classifies chunks (Phase 1 recon) by content + schema names.
//! 3. (todo) parse the logical hierarchy, geometry, fragments / spatial graph.
//! 4. (todo) assemble GLB.
//!
//! Correctness was established against two independent references — the
//! Navisworks FBX export and the source attribute files of the Huldra dataset;
//! the format knowledge and the measured results are in
//! `docs/what_we_know_v1.md`.

pub mod chunk8;
pub mod container;
pub mod convert;
pub mod cursor;
pub mod error;
pub mod fragments;
pub mod geometry;
pub mod glb;
pub mod hierarchy;
pub mod inspect;
pub mod properties;

pub use container::{Chunk, Container};
pub use error::{Error, Result};

/// A float type usable as a sort key through [`fcmp`].
pub(crate) trait FloatKey: PartialOrd + Copy {
    fn total(self, other: Self) -> std::cmp::Ordering;
}

impl FloatKey for f32 {
    fn total(self, other: Self) -> std::cmp::Ordering {
        self.total_cmp(&other)
    }
}

impl FloatKey for f64 {
    fn total(self, other: Self) -> std::cmp::Ordering {
        self.total_cmp(&other)
    }
}

/// Ordering for float sort keys derived from file data.
///
/// For ordinary numbers this IS `partial_cmp` (−0.0 == +0.0), so stable sorts
/// and `min_by` ties keep their order and the output bytes do not move. A NaN
/// — reachable as inf − inf on finite but absurd coordinates — falls back to
/// `total_cmp` instead of panicking (a panic aborts the wasm import). The
/// result stays a total order, which std's sorts require (they may panic on
/// an inconsistent comparator, so `unwrap_or(Equal)` is not enough there).
pub(crate) fn fcmp<T: FloatKey>(a: T, b: T) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or_else(|| a.total(b))
}

#[cfg(test)]
mod tests {
    use super::fcmp;
    use std::cmp::Ordering;

    #[test]
    fn fcmp_is_partial_cmp_for_numbers_and_total_for_nan() {
        assert_eq!(fcmp(-0.0f32, 0.0), Ordering::Equal);
        assert_eq!(fcmp(1.0f64, 2.0), Ordering::Less);
        assert_eq!(fcmp(f64::INFINITY, 2.0), Ordering::Greater);
        assert_eq!(fcmp(1.0f32, f32::NAN), Ordering::Less);
        assert_eq!(fcmp(f32::NAN, 1.0), Ordering::Greater);
        // inf − inf: the NaN a sort key gets from absurd coordinates. Sorting
        // must not panic and must leave the ordinary numbers in order.
        let nan = f32::INFINITY - f32::INFINITY;
        let mut v = [3.0f32, nan, 1.0, f32::NAN, 2.0, nan, 0.5];
        v.sort_by(|a, b| fcmp(*a, *b));
        let numbers: Vec<f32> = v.iter().copied().filter(|x| !x.is_nan()).collect();
        assert_eq!(numbers, [0.5, 1.0, 2.0, 3.0]);
    }
}

/// Parse an NWD/NWC byte buffer into its container chunk index
/// (payloads inflate lazily via [`Container::data`]).
pub fn parse(bytes: &[u8]) -> Result<Container<'_>> {
    Container::parse(bytes)
}
