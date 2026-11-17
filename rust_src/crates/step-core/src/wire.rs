//! Tiny little-endian byte writer/reader for the spill and cache records
//! (tessellated meshes handed between the merge walk, the temp file and the
//! tessellation sub-workers). No framing, no versioning: records are private
//! to one conversion run and never leave the temp files.

/// Append little-endian scalars and slices to a byte vector.
pub struct Writer<'a>(pub &'a mut Vec<u8>);

impl Writer<'_> {
    pub fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    pub fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    pub fn f32(&mut self, v: f32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u32s(&mut self, v: &[u32]) {
        self.u32(v.len() as u32);
        self.0.reserve(v.len() * 4);
        for x in v {
            self.0.extend_from_slice(&x.to_le_bytes());
        }
    }
    pub fn f32s(&mut self, v: &[f32]) {
        self.u32(v.len() as u32);
        self.0.reserve(v.len() * 4);
        for x in v {
            self.0.extend_from_slice(&x.to_le_bytes());
        }
    }
    pub fn f64s(&mut self, v: &[f64]) {
        self.u32(v.len() as u32);
        self.0.reserve(v.len() * 8);
        for x in v {
            self.0.extend_from_slice(&x.to_le_bytes());
        }
    }
}

/// Cursor over a byte slice; every read returns `None` past the end so a
/// truncated record fails soft instead of panicking.
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        if end > self.buf.len() {
            return None;
        }
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Some(s)
    }

    pub fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|s| s[0])
    }
    /// The next `n` raw bytes.
    pub fn bytes(&mut self, n: usize) -> Option<&'a [u8]> {
        self.take(n)
    }
    pub fn u32(&mut self) -> Option<u32> {
        self.take(4)
            .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
    }
    pub fn f32(&mut self) -> Option<f32> {
        self.take(4)
            .map(|s| f32::from_le_bytes(s.try_into().unwrap()))
    }
    pub fn u32s(&mut self) -> Option<Vec<u32>> {
        let n = self.u32()? as usize;
        let s = self.take(n.checked_mul(4)?)?;
        Some(
            s.chunks_exact(4)
                .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
                .collect(),
        )
    }
    pub fn f32s(&mut self) -> Option<Vec<f32>> {
        let n = self.u32()? as usize;
        let s = self.take(n.checked_mul(4)?)?;
        Some(
            s.chunks_exact(4)
                .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
                .collect(),
        )
    }
    pub fn f64s(&mut self) -> Option<Vec<f64>> {
        let n = self.u32()? as usize;
        let s = self.take(n.checked_mul(8)?)?;
        Some(
            s.chunks_exact(8)
                .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
                .collect(),
        )
    }
    pub fn is_at_end(&self) -> bool {
        self.pos >= self.buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_scalars_and_slices() {
        let mut buf = Vec::new();
        let mut w = Writer(&mut buf);
        w.u8(7);
        w.u32(0xdead_beef);
        w.f32(1.5);
        w.u32s(&[1, 2, 3]);
        w.f32s(&[0.25]);
        w.f64s(&[-1.0, 2.5e10]);
        let mut r = Reader::new(&buf);
        assert_eq!(r.u8(), Some(7));
        assert_eq!(r.u32(), Some(0xdead_beef));
        assert_eq!(r.f32(), Some(1.5));
        assert_eq!(r.u32s(), Some(vec![1, 2, 3]));
        assert_eq!(r.f32s(), Some(vec![0.25]));
        assert_eq!(r.f64s(), Some(vec![-1.0, 2.5e10]));
        assert!(r.is_at_end());
        assert_eq!(r.u8(), None, "past the end fails soft");
    }
}
