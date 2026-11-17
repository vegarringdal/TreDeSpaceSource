//! Random-access byte sources.
//!
//! Scan files are routinely 5–50 GB, so nothing in this crate holds a whole
//! file in memory: every reader pulls the byte ranges it needs through
//! [`ReadAt`]. Native code uses [`FileSource`] (positional reads, no shared
//! cursor, safe to share across threads); a wasm host implements the trait
//! over an OPFS sync access handle; tests use [`SliceSource`].

use std::sync::Arc;

use crate::error::{Error, Result};

/// A random-access, read-only byte source of known length.
pub trait ReadAt: Send + Sync {
    /// Total length in bytes.
    fn len(&self) -> u64;

    /// Fill `buf` from `offset`. Reading past the end is an error.
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()>;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Read `len` bytes at `offset` into a new vector.
    fn read_vec(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
        let mut v = vec![0u8; len];
        self.read_at(offset, &mut v)?;
        Ok(v)
    }
}

/// Shared handle to a source; readers keep one of these.
pub type Source = Arc<dyn ReadAt>;

impl<T: ReadAt + ?Sized> ReadAt for Arc<T> {
    fn len(&self) -> u64 {
        (**self).len()
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        (**self).read_at(offset, buf)
    }
}

/// In-memory source (tests, small files, already-downloaded buffers).
pub struct SliceSource {
    data: Vec<u8>,
}

impl SliceSource {
    pub fn new(data: Vec<u8>) -> Self {
        SliceSource { data }
    }
}

impl ReadAt for SliceSource {
    fn len(&self) -> u64 {
        self.data.len() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        let end = offset
            .checked_add(buf.len() as u64)
            .filter(|&e| e <= self.data.len() as u64)
            .ok_or(Error::Eof {
                offset,
                len: buf.len() as u64,
            })?;
        buf.copy_from_slice(&self.data[offset as usize..end as usize]);
        Ok(())
    }
}

/// A window `[start, start+len)` of another source, addressed from 0.
pub struct SubSource {
    inner: Source,
    start: u64,
    len: u64,
}

impl SubSource {
    pub fn new(inner: Source, start: u64, len: u64) -> Result<Self> {
        if start.checked_add(len).is_none_or(|e| e > inner.len()) {
            return Err(Error::Eof { offset: start, len });
        }
        Ok(SubSource { inner, start, len })
    }
}

impl ReadAt for SubSource {
    fn len(&self) -> u64 {
        self.len
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        if offset
            .checked_add(buf.len() as u64)
            .is_none_or(|e| e > self.len)
        {
            return Err(Error::Eof {
                offset,
                len: buf.len() as u64,
            });
        }
        self.inner.read_at(self.start + offset, buf)
    }
}

/// A file on disk, read with positional I/O (no seek state shared between
/// threads).
#[cfg(not(target_arch = "wasm32"))]
pub struct FileSource {
    file: std::fs::File,
    len: u64,
}

#[cfg(not(target_arch = "wasm32"))]
impl FileSource {
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<Self> {
        let file = std::fs::File::open(path.as_ref())?;
        let len = file.metadata()?.len();
        Ok(FileSource { file, len })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl ReadAt for FileSource {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        if offset
            .checked_add(buf.len() as u64)
            .is_none_or(|e| e > self.len)
        {
            return Err(Error::Eof {
                offset,
                len: buf.len() as u64,
            });
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            self.file.read_exact_at(buf, offset)?;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;
            let mut done = 0usize;
            while done < buf.len() {
                let n = self
                    .file
                    .seek_read(&mut buf[done..], offset + done as u64)?;
                if n == 0 {
                    return Err(Error::Eof {
                        offset,
                        len: buf.len() as u64,
                    });
                }
                done += n;
            }
        }
        Ok(())
    }
}

/// Open a file as a shared [`Source`].
#[cfg(not(target_arch = "wasm32"))]
pub fn open_file(path: impl AsRef<std::path::Path>) -> Result<Source> {
    Ok(Arc::new(FileSource::open(path)?))
}

/// Little-endian field readers over a byte slice, with bounds errors instead
/// of panics (all parsed input is untrusted).
pub(crate) struct Le<'a> {
    pub buf: &'a [u8],
    pub pos: usize,
}

impl<'a> Le<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Le { buf, pos: 0 }
    }
    pub fn at(buf: &'a [u8], pos: usize) -> Self {
        Le { buf, pos }
    }
    pub fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }
    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|&e| e <= self.buf.len())
            .ok_or_else(|| {
                Error::Format(format!("truncated record: need {n} bytes at {}", self.pos))
            })?;
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    pub fn skip(&mut self, n: usize) -> Result<()> {
        self.bytes(n).map(|_| ())
    }
    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }
    pub fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.bytes(2)?.try_into().unwrap()))
    }
    pub fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    pub fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }
    pub fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }
}
