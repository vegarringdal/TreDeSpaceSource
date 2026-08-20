//! Synchronous I/O handles injected into the pipeline so the core never knows
//! whether it is talking to a `Vec`, a memory-mapped file, a temp file, or the
//! browser's OPFS. Three handles cover the whole data path:
//!
//! - [`InputHandle`] — random-access read of the STEP source (read-only).
//! - [`OutputHandle`] — append-only sink for the final GLB.
//! - [`TempHandle`] — random-access scratch for spilling tessellated geometry
//!   when staying under a memory ceiling (`--memory-threshold`).
//!
//! All three are **synchronous** on purpose: the CPU-bound core (recursive
//! tessellation, Newton loops) must not become `async`. In the browser the host
//! runs the core in a Web Worker and backs these with OPFS
//! `FileSystemSyncAccessHandle`s, which are synchronous in that context. Native
//! builds back them with `mmap` / `File` / a temp file; the C ABI can back them
//! with caller-supplied callbacks.
//!
//! Stage 1 ships the traits with in-memory (`Vec<u8>`) implementations only —
//! byte-for-byte today's behaviour. The mmap input, the temp-file spill and the
//! OPFS handles land in later stages; the zero-copy `bytes(.., scratch)` borrow
//! path (so the parser stays zero-copy on mmap and copies on OPFS) arrives with
//! the mmap input in stage 2.

use std::io;

/// Random-access, read-only source of the STEP input.
// `Send + Sync` so a `StepFile` holding a `Reader` source stays `Sync` for the
// threaded tessellation path. The in-memory impls satisfy it for free; a wasm
// OPFS-backed handle is single-threaded and adds an `unsafe impl` (sound on
// wasm32, which has no real threads).
pub trait InputHandle: Send + Sync {
    /// Total size of the source in bytes.
    fn size(&self) -> u64;
    /// Read up to `buf.len()` bytes starting at `offset`; returns the number of
    /// bytes read (0 at or past the end). Does not have to fill `buf`.
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize>;
}

/// Append-only sink for the final GLB container.
pub trait OutputHandle {
    /// Append `buf` to the output.
    fn write(&mut self, buf: &[u8]) -> io::Result<()>;
}

/// Random-access read/write scratch for spilling geometry off the heap. Space
/// is never reused and ordering does not matter, so callers use it append-style
/// (`write_at(len(), ..)`), but the random-access shape maps 1:1 onto an OPFS
/// sync handle and a `File`, and leaves room for in-place accessor rewrites.
pub trait TempHandle {
    /// Write `buf` at `offset`, growing the backing store as needed.
    fn write_at(&mut self, offset: u64, buf: &[u8]) -> io::Result<()>;
    /// Read up to `buf.len()` bytes starting at `offset`; returns bytes read.
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize>;
    /// Current length of the backing store in bytes.
    fn len(&self) -> u64;
    /// True when nothing has been spilled yet.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// --------------------------------------------------------- in-memory backings

/// Copy `[offset, offset+buf.len())` of `data` into `buf`, returning the count.
fn read_slice(data: &[u8], offset: u64, buf: &mut [u8]) -> usize {
    let start = (offset as usize).min(data.len());
    let n = buf.len().min(data.len() - start);
    buf[..n].copy_from_slice(&data[start..start + n]);
    n
}

impl InputHandle for Vec<u8> {
    fn size(&self) -> u64 {
        self.len() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        Ok(read_slice(self, offset, buf))
    }
}

impl InputHandle for &[u8] {
    fn size(&self) -> u64 {
        self.len() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        Ok(read_slice(self, offset, buf))
    }
}

/// In-memory output sink — the default, all-in-RAM behaviour.
#[derive(Default)]
pub struct MemSink(pub Vec<u8>);

impl OutputHandle for MemSink {
    fn write(&mut self, buf: &[u8]) -> io::Result<()> {
        self.0.extend_from_slice(buf);
        Ok(())
    }
}

/// In-memory spill buffer — the default `TempHandle`, used when no on-disk
/// threshold is set (geometry stays on the heap).
#[derive(Default)]
pub struct MemTemp(pub Vec<u8>);

impl TempHandle for MemTemp {
    fn write_at(&mut self, offset: u64, buf: &[u8]) -> io::Result<()> {
        let end = offset as usize + buf.len();
        if self.0.len() < end {
            self.0.resize(end, 0);
        }
        self.0[offset as usize..end].copy_from_slice(buf);
        Ok(())
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        Ok(read_slice(&self.0, offset, buf))
    }
    fn len(&self) -> u64 {
        self.0.len() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_handle_reads_ranges_and_clamps_at_end() {
        let data: Vec<u8> = (0u8..10).collect();
        let mut buf = [0u8; 4];
        assert_eq!(data.read_at(2, &mut buf).unwrap(), 4);
        assert_eq!(buf, [2, 3, 4, 5]);
        // a read straddling the end returns only the available bytes
        let mut tail = [0u8; 4];
        assert_eq!(data.read_at(8, &mut tail).unwrap(), 2);
        assert_eq!(&tail[..2], &[8, 9]);
        // at/past the end yields nothing
        assert_eq!(data.read_at(10, &mut buf).unwrap(), 0);
        assert_eq!(InputHandle::size(&data), 10);
    }

    #[test]
    fn temp_handle_grows_and_round_trips() {
        let mut t = MemTemp::default();
        assert!(t.is_empty());
        t.write_at(0, &[1, 2, 3]).unwrap();
        t.write_at(5, &[9]).unwrap(); // sparse write grows with a zero gap
        assert_eq!(t.len(), 6);
        let mut buf = [0u8; 6];
        assert_eq!(t.read_at(0, &mut buf).unwrap(), 6);
        assert_eq!(buf, [1, 2, 3, 0, 0, 9]);
    }

    #[test]
    fn mem_sink_appends() {
        let mut s = MemSink::default();
        s.write(b"ab").unwrap();
        s.write(b"cd").unwrap();
        assert_eq!(s.0, b"abcd");
    }
}
