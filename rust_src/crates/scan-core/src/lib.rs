//! scan-core — readers for laser-scan deliverables:
//!
//! * [`e57`] — ASTM E57 (E2807): scans with streamed point decoding, images.
//! * [`lgsx`] — Leica LGSX (Cyclone REGISTER 360 / TruView / JetStream
//!   exports): the HSPC point octree, setups with poses, cube panoramas.
//!   The format is undocumented; `docs/LGSX_FORMAT.md` records what is known.
//!
//! Both read through [`source::ReadAt`] so multi-GB files are never loaded
//! whole (and a wasm host can back the reads with OPFS).

pub mod e57;
pub mod error;
pub mod lgsx;
pub mod model;
pub mod source;
pub mod sqlite;

pub use error::{Error, Result};
pub use model::{Aabb, ImageFormat, PointBatch, Pose};
pub use source::{ReadAt, Source};
