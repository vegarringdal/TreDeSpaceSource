//! Progress reporting shared by every pipeline stage.
//!
//! A [`ProgressSink`] is a shared (`&self`) reporter so one instance can be
//! handed to the parser, the per-face tessellation loop and the merge walk at
//! the same time; the wasm shell backs it with a JS callback, tests with a
//! `Mutex<Vec<_>>`. Faces are the fine-grained unit — a single huge solid still
//! moves the bar — and [`FaceProgress`] throttles those ticks so a million-face
//! model doesn't spend its time in the callback.

use std::sync::atomic::{AtomicU64, Ordering};

/// Which stage a `(done, total)` pair belongs to. The discriminants are the
/// numbers the wasm shell passes to JS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Phase {
    /// indexing the STEP text: bytes scanned / file size
    Index = 0,
    /// tessellation: faces done / faces in the file
    Faces = 1,
    /// merge walk: unique products placed / product count
    Products = 2,
    /// cooking (no sub-progress; fired once with 0/1)
    Cook = 3,
    /// writing the output (fired once with 0/1)
    Write = 4,
}

impl Phase {
    /// The wire number the wasm shell forwards to JS.
    pub fn code(self) -> u8 {
        self as u8
    }
}

pub trait ProgressSink {
    fn report(&self, phase: Phase, done: u64, total: u64);
}

/// The silent sink for callers without a UI.
pub struct NoProgress;

impl ProgressSink for NoProgress {
    fn report(&self, _phase: Phase, _done: u64, _total: u64) {}
}

/// Number of face ticks between two reports (0.5 % steps).
const FACE_REPORT_STEPS: u64 = 200;

/// Throttled per-face tick counter, shared with the tessellation context so
/// the face loop (serial or threaded) can report without knowing the sink.
pub struct FaceProgress<'a> {
    done: AtomicU64,
    total: u64,
    step: u64,
    sink: &'a (dyn ProgressSink + Sync),
}

impl<'a> FaceProgress<'a> {
    pub fn new(total: u64, sink: &'a (dyn ProgressSink + Sync)) -> Self {
        FaceProgress {
            done: AtomicU64::new(0),
            total: total.max(1),
            step: (total / FACE_REPORT_STEPS).max(1),
            sink,
        }
    }

    /// Continue counting from `done` (a worker's next batch).
    pub fn starting_at(self, done: u64) -> Self {
        self.done.store(done, Ordering::Relaxed);
        self
    }

    /// One face finished. Reports every `step` faces and on the last one.
    pub fn tick(&self) {
        let n = self.done.fetch_add(1, Ordering::Relaxed) + 1;
        if n % self.step == 0 || n == self.total {
            self.sink
                .report(Phase::Faces, n.min(self.total), self.total);
        }
    }

    pub fn done(&self) -> u64 {
        self.done.load(Ordering::Relaxed)
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    /// Force a final `total/total` report (the face count is an upper bound —
    /// faces of products that are never instanced are never tessellated).
    pub fn finish(&self) {
        self.sink.report(Phase::Faces, self.total, self.total);
    }
}

/// Adapter for the legacy `FnMut(done, total)` product-progress callbacks:
/// forwards only [`Phase::Products`] ticks, as `u32`s.
pub struct ProductsOnly<'a>(pub std::sync::Mutex<&'a mut (dyn FnMut(u32, u32) + Send)>);

impl ProgressSink for ProductsOnly<'_> {
    fn report(&self, phase: Phase, done: u64, total: u64) {
        if phase != Phase::Products {
            return;
        }
        if let Ok(mut f) = self.0.lock() {
            f(done as u32, total as u32);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Rec(Mutex<Vec<(Phase, u64, u64)>>);
    impl ProgressSink for Rec {
        fn report(&self, phase: Phase, done: u64, total: u64) {
            self.0.lock().unwrap().push((phase, done, total));
        }
    }

    #[test]
    fn face_progress_throttles_and_ends_on_total() {
        let rec = Rec(Mutex::new(Vec::new()));
        let fp = FaceProgress::new(1000, &rec);
        for _ in 0..1000 {
            fp.tick();
        }
        let ticks = rec.0.lock().unwrap();
        assert_eq!(ticks.len(), 200, "0.5% steps");
        assert_eq!(*ticks.last().unwrap(), (Phase::Faces, 1000, 1000));
        assert!(ticks.windows(2).all(|w| w[1].1 > w[0].1));
    }

    #[test]
    fn tiny_totals_tick_every_face() {
        let rec = Rec(Mutex::new(Vec::new()));
        let fp = FaceProgress::new(3, &rec);
        fp.tick();
        fp.tick();
        fp.tick();
        assert_eq!(rec.0.lock().unwrap().len(), 3);
    }
}
