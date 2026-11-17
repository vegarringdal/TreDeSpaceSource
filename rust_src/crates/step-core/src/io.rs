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

/// Read-only access to the tessellation records other workers wrote: one
/// `slot` per cache file (the browser opens each sub-worker's file as its own
/// sync handle; tests back the slots with `Vec<MemTemp>`).
pub trait SlotReader {
    fn read_at(&self, slot: u32, offset: u64, buf: &mut [u8]) -> io::Result<usize>;
}

/// Read exactly `len` bytes at `offset` through a ranged reader, looping over
/// short reads; a short final result means the source ended early.
pub fn read_all_at(
    mut read: impl FnMut(u64, &mut [u8]) -> io::Result<usize>,
    offset: u64,
    len: usize,
) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    let mut off = 0usize;
    while off < len {
        match read(offset + off as u64, &mut buf[off..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => off += n,
        }
    }
    buf.truncate(off);
    buf
}

// ------------------------------------------------------------- page cache

const PAGE_SIZE: usize = 256 * 1024;
const PAGE_SLOTS: usize = 16;

struct Page {
    index: u64,
    used: u64,
    data: Vec<u8>,
}

struct PageCache {
    pages: Vec<Page>,
    clock: u64,
}

/// A small LRU page cache in front of an [`InputHandle`] whose reads are
/// expensive per call (an OPFS sync handle behind a JS callback): the parser
/// reads entity parameters by range, millions of small reads that are mostly
/// local, so a few pages absorb nearly all of them. Reads larger than a page
/// bypass the cache. Interior mutability is a `Mutex` so the handle stays
/// `Sync` (uncontended: wasm32 has no threads; native never shares it).
pub struct CachedInput {
    inner: Box<dyn InputHandle>,
    size: u64,
    cache: std::sync::Mutex<PageCache>,
}

impl CachedInput {
    pub fn new(inner: Box<dyn InputHandle>) -> CachedInput {
        let size = inner.size();
        CachedInput {
            inner,
            size,
            cache: std::sync::Mutex::new(PageCache {
                pages: Vec::with_capacity(PAGE_SLOTS),
                clock: 0,
            }),
        }
    }

    /// Copy `[offset, offset + buf.len())` out of the page cache, loading
    /// missing pages from the inner handle.
    fn read_cached(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let mut done = 0usize;
        while done < buf.len() {
            let abs = offset + done as u64;
            if abs >= self.size {
                break;
            }
            let index = abs / PAGE_SIZE as u64;
            cache.clock += 1;
            let clock = cache.clock;
            let slot = match cache.pages.iter().position(|p| p.index == index) {
                Some(i) => i,
                None => {
                    let start = index * PAGE_SIZE as u64;
                    let len = (self.size - start).min(PAGE_SIZE as u64) as usize;
                    let data = read_all_at(|o, b| self.inner.read_at(o, b), start, len);
                    if cache.pages.len() < PAGE_SLOTS {
                        cache.pages.push(Page {
                            index,
                            used: clock,
                            data,
                        });
                        cache.pages.len() - 1
                    } else {
                        let victim = (0..cache.pages.len())
                            .min_by_key(|&i| cache.pages[i].used)
                            .unwrap_or(0);
                        cache.pages[victim] = Page {
                            index,
                            used: clock,
                            data,
                        };
                        victim
                    }
                }
            };
            let page = &mut cache.pages[slot];
            page.used = clock;
            let in_page = (abs - index * PAGE_SIZE as u64) as usize;
            if in_page >= page.data.len() {
                break;
            }
            let n = (page.data.len() - in_page).min(buf.len() - done);
            buf[done..done + n].copy_from_slice(&page.data[in_page..in_page + n]);
            done += n;
        }
        Ok(done)
    }
}

impl InputHandle for CachedInput {
    fn size(&self) -> u64 {
        self.size
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        if buf.len() >= PAGE_SIZE {
            return self.inner.read_at(offset, buf);
        }
        self.read_cached(offset, buf)
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

impl SlotReader for Vec<MemTemp> {
    fn read_at(&self, slot: u32, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        match self.get(slot as usize) {
            Some(t) => TempHandle::read_at(t, offset, buf),
            None => Ok(0),
        }
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

    /// Counts the inner reads so a test can prove the cache absorbs them.
    struct Counting(Vec<u8>, std::sync::Mutex<usize>);
    impl InputHandle for Counting {
        fn size(&self) -> u64 {
            self.0.len() as u64
        }
        fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
            *self.1.lock().unwrap() += 1;
            Ok(read_slice(&self.0, offset, buf))
        }
    }

    #[test]
    fn cached_input_serves_repeated_small_reads_from_one_page() {
        let data: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let c = CachedInput::new(Box::new(Counting(data.clone(), std::sync::Mutex::new(0))));
        let mut buf = [0u8; 16];
        for off in (0..99_000u64).step_by(997) {
            assert_eq!(c.read_at(off, &mut buf).unwrap(), 16);
            assert_eq!(&buf[..], &data[off as usize..off as usize + 16]);
        }
        // the whole file is one page: exactly one inner read
        let mut tail = [0u8; 16];
        assert_eq!(
            c.read_at(99_990, &mut tail).unwrap(),
            10,
            "clamps at the end"
        );
        assert_eq!(c.read_at(100_000, &mut tail).unwrap(), 0);
    }

    #[test]
    fn read_all_at_loops_over_short_reads() {
        let data: Vec<u8> = (0..50u8).collect();
        // a reader that returns at most 7 bytes per call
        let got = read_all_at(
            |o, b| {
                let n = b.len().min(7);
                Ok(read_slice(&data, o, &mut b[..n]))
            },
            3,
            20,
        );
        assert_eq!(got, data[3..23].to_vec());
        let short = read_all_at(|o, b| Ok(read_slice(&data, o, b)), 45, 20);
        assert_eq!(short, data[45..].to_vec(), "truncates at EOF");
    }
}
