//! Little-endian byte forms of the cook stages' results — what crosses
//! between the coordinator and the sub-workers in the browser.

use crate::format::{NodeRecord, NODE_RECORD_SIZE};
use crate::node::{Encoded, NodeKey};
use crate::Result;

#[derive(Default)]
pub(crate) struct Out(pub(crate) Vec<u8>);

impl Out {
    pub(crate) fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    pub(crate) fn u32(&mut self, v: u32) {
        self.0.extend(v.to_le_bytes());
    }
    pub(crate) fn u64(&mut self, v: u64) {
        self.0.extend(v.to_le_bytes());
    }
    pub(crate) fn f64(&mut self, v: f64) {
        self.0.extend(v.to_le_bytes());
    }
    pub(crate) fn bytes(&mut self, v: &[u8]) {
        self.u64(v.len() as u64);
        self.0.extend(v);
    }
    pub(crate) fn key(&mut self, k: &NodeKey) {
        self.u8(k.depth);
        self.u32(k.x);
        self.u32(k.y);
        self.u32(k.z);
    }
    pub(crate) fn node(&mut self, n: &Encoded) {
        self.key(&n.key);
        n.record.write(&mut self.0);
        self.bytes(&n.payload);
    }
}

pub(crate) struct In<'a>(pub(crate) &'a [u8]);

impl<'a> In<'a> {
    pub(crate) fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.0.len() < n {
            return Err("truncated cook stage data".into());
        }
        let (a, b) = self.0.split_at(n);
        self.0 = b;
        Ok(a)
    }
    pub(crate) fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(crate) fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub(crate) fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub(crate) fn bytes(&mut self) -> Result<&'a [u8]> {
        let n = self.u64()? as usize;
        self.take(n)
    }
    pub(crate) fn key(&mut self) -> Result<NodeKey> {
        Ok(NodeKey {
            depth: self.u8()?,
            x: self.u32()?,
            y: self.u32()?,
            z: self.u32()?,
        })
    }
    pub(crate) fn node(&mut self) -> Result<Encoded> {
        Ok(Encoded {
            key: self.key()?,
            record: NodeRecord::parse(self.take(NODE_RECORD_SIZE)?),
            payload: self.bytes()?.to_vec(),
        })
    }
}
