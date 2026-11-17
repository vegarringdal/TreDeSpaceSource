//! E57 physical layer: the file is a sequence of pages (normally 1024 bytes);
//! the last 4 bytes of each page are a CRC-32C of the rest. Everything above
//! this layer (XML, binary sections) is addressed in *logical* bytes with the
//! checksums removed, but the XML and binary sections reference each other
//! with *physical* offsets.

use crate::error::{Error, Result};
use crate::source::Source;

const CRC_LEN: u64 = 4;

#[derive(Clone)]
pub struct Paged {
    src: Source,
    page: u64,
    logical_page: u64,
    verify: bool,
}

impl Paged {
    pub fn new(src: Source, page_size: u64, verify: bool) -> Result<Self> {
        if !(64..=1 << 24).contains(&page_size) {
            return Err(Error::Format(format!(
                "implausible E57 page size {page_size}"
            )));
        }
        Ok(Paged {
            src,
            page: page_size,
            logical_page: page_size - CRC_LEN,
            verify,
        })
    }

    pub fn page_size(&self) -> u64 {
        self.page
    }

    pub fn phys_to_logical(&self, phys: u64) -> u64 {
        (phys / self.page) * self.logical_page + (phys % self.page).min(self.logical_page)
    }

    pub fn logical_to_phys(&self, logical: u64) -> u64 {
        (logical / self.logical_page) * self.page + logical % self.logical_page
    }

    /// Logical length available in the file (its physical length, minus the
    /// checksums).
    pub fn logical_len(&self) -> u64 {
        self.phys_to_logical(self.src.len())
    }

    /// Fill `buf` with logical bytes starting at logical offset `logical`.
    pub fn read_logical(&self, logical: u64, buf: &mut [u8]) -> Result<()> {
        if buf.is_empty() {
            return Ok(());
        }
        let first_page = logical / self.logical_page;
        let last_page = (logical + buf.len() as u64 - 1) / self.logical_page;
        // Read whole pages so checksums can be verified; bounded chunks keep
        // the scratch buffer small for large reads.
        const PAGES_PER_READ: u64 = 1024;
        let mut out = 0usize;
        let mut pg = first_page;
        let mut scratch = Vec::new();
        while pg <= last_page {
            let n = (last_page - pg + 1).min(PAGES_PER_READ);
            let phys = pg * self.page;
            // the final page of a truncated file may be short; the per-chunk
            // check below reports EOF only if the wanted bytes are missing
            let take = (n * self.page).min(self.src.len().saturating_sub(phys));
            if take == 0 {
                return Err(Error::Eof {
                    offset: phys,
                    len: n * self.page,
                });
            }
            scratch.resize(take as usize, 0);
            self.src.read_at(phys, &mut scratch)?;
            for (i, chunk) in scratch.chunks(self.page as usize).enumerate() {
                let this = pg + i as u64;
                if self.verify && chunk.len() == self.page as usize {
                    let (data, crc) = chunk.split_at(self.logical_page as usize);
                    if crc32c(data).to_be_bytes() != crc {
                        return Err(Error::Checksum {
                            what: "E57 page",
                            offset: this * self.page,
                        });
                    }
                }
                let page_lo = this * self.logical_page;
                let lo = logical.max(page_lo) - page_lo;
                let hi = (logical + buf.len() as u64).min(page_lo + self.logical_page) - page_lo;
                if hi > lo {
                    let hi_c = (hi as usize).min(chunk.len());
                    if hi_c < hi as usize {
                        return Err(Error::Eof {
                            offset: this * self.page + lo,
                            len: hi - lo,
                        });
                    }
                    let len = (hi - lo) as usize;
                    buf[out..out + len].copy_from_slice(&chunk[lo as usize..hi as usize]);
                    out += len;
                }
            }
            pg += n;
        }
        if out != buf.len() {
            return Err(Error::Eof {
                offset: self.logical_to_phys(logical),
                len: buf.len() as u64,
            });
        }
        Ok(())
    }

    pub fn read_logical_vec(&self, logical: u64, len: usize) -> Result<Vec<u8>> {
        let mut v = vec![0u8; len];
        self.read_logical(logical, &mut v)?;
        Ok(v)
    }
}

/// Sequential logical reader with a large read-ahead window (binary sections
/// are consumed front to back).
pub struct LogicalCursor<'a> {
    paged: &'a Paged,
    win_start: u64,
    win: Vec<u8>,
    window: usize,
}

impl<'a> LogicalCursor<'a> {
    pub fn new(paged: &'a Paged, window: usize) -> Self {
        LogicalCursor {
            paged,
            win_start: 0,
            win: Vec::new(),
            window: window.max(1 << 16),
        }
    }

    /// Borrow `len` logical bytes at `logical`, refilling the window as needed.
    pub fn get(&mut self, logical: u64, len: usize) -> Result<&[u8]> {
        let in_window = logical >= self.win_start
            && logical + len as u64 <= self.win_start + self.win.len() as u64;
        if !in_window {
            let avail = self.paged.logical_len().saturating_sub(logical);
            let want = (self.window.max(len) as u64).min(avail.max(len as u64)) as usize;
            self.win.resize(want, 0);
            self.paged.read_logical(logical, &mut self.win)?;
            self.win_start = logical;
        }
        let o = (logical - self.win_start) as usize;
        Ok(&self.win[o..o + len])
    }
}

/// CRC-32C (Castagnoli), as used for E57 page checksums.
pub fn crc32c(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[[u32; 256]; 8]> = std::sync::OnceLock::new();
    let t = TABLE.get_or_init(|| {
        let mut t = [[0u32; 256]; 8];
        for i in 0..256u32 {
            let mut c = i;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    (c >> 1) ^ 0x82F6_3B78
                } else {
                    c >> 1
                };
            }
            t[0][i as usize] = c;
        }
        for i in 0..256 {
            for k in 1..8 {
                let prev = t[k - 1][i];
                t[k][i] = (prev >> 8) ^ t[0][(prev & 0xFF) as usize];
            }
        }
        t
    });
    let mut crc = !0u32;
    let mut chunks = data.chunks_exact(8);
    for c in &mut chunks {
        let lo = u32::from_le_bytes([c[0], c[1], c[2], c[3]]) ^ crc;
        let hi = u32::from_le_bytes([c[4], c[5], c[6], c[7]]);
        crc = t[7][(lo & 0xFF) as usize]
            ^ t[6][((lo >> 8) & 0xFF) as usize]
            ^ t[5][((lo >> 16) & 0xFF) as usize]
            ^ t[4][(lo >> 24) as usize]
            ^ t[3][(hi & 0xFF) as usize]
            ^ t[2][((hi >> 8) & 0xFF) as usize]
            ^ t[1][((hi >> 16) & 0xFF) as usize]
            ^ t[0][(hi >> 24) as usize];
    }
    for &b in chunks.remainder() {
        crc = t[0][((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32c_check_value() {
        // RFC 3720 / iSCSI check value
        assert_eq!(crc32c(b"123456789"), 0xE306_9283);
    }
}
