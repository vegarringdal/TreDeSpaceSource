//! Minimal read-only SQLite reader: walk a table b-tree and decode its rows.
//! Enough for the small project databases embedded in LGSX files, with no C
//! dependency (wasm-safe). Indexes, WAL files and writes are out of scope.

use crate::error::{fmt_err, Error, Result};

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl Value {
    pub fn as_f64(&self) -> Option<f64> {
        match *self {
            Value::Int(i) => Some(i as f64),
            Value::Real(r) => Some(r),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match *self {
            Value::Int(i) => Some(i),
            Value::Real(r) => Some(r as i64),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Text(s) => Some(s),
            _ => None,
        }
    }
}

pub struct Table {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

impl Table {
    pub fn col(&self, name: &str) -> Option<usize> {
        self.columns
            .iter()
            .position(|c| c.eq_ignore_ascii_case(name))
    }
    /// Cell of a row by column name (`Null` if the column is unknown).
    pub fn get<'a>(&self, row: &'a [Value], name: &str) -> &'a Value {
        static NULL: Value = Value::Null;
        self.col(name).and_then(|i| row.get(i)).unwrap_or(&NULL)
    }
}

pub struct Db<'a> {
    data: &'a [u8],
    page_size: usize,
    usable: usize,
}

fn varint(b: &[u8], p: &mut usize) -> Result<u64> {
    let mut v = 0u64;
    for i in 0..9 {
        let c = *b
            .get(*p)
            .ok_or_else(|| Error::Format("sqlite: truncated varint".into()))?;
        *p += 1;
        if i == 8 {
            return Ok((v << 8) | c as u64);
        }
        v = (v << 7) | (c & 0x7F) as u64;
        if c < 0x80 {
            break;
        }
    }
    Ok(v)
}

fn be(b: &[u8]) -> u64 {
    b.iter().fold(0u64, |a, &c| (a << 8) | c as u64)
}

impl<'a> Db<'a> {
    pub fn open(data: &'a [u8]) -> Result<Db<'a>> {
        if data.len() < 100 || &data[..16] != b"SQLite format 3\0" {
            return fmt_err("not an SQLite database");
        }
        let ps = be(&data[16..18]) as usize;
        let page_size = if ps == 1 { 65536 } else { ps };
        if !(512..=65536).contains(&page_size) || !page_size.is_power_of_two() {
            return fmt_err(format!("sqlite: page size {page_size}"));
        }
        if be(&data[56..60]) > 1 {
            return Err(Error::Unsupported("sqlite: non-UTF-8 text encoding".into()));
        }
        let usable = page_size - data[20] as usize;
        Ok(Db {
            data,
            page_size,
            usable,
        })
    }

    fn page(&self, n: u32) -> Result<&'a [u8]> {
        let n = n as usize;
        if n == 0 {
            return fmt_err("sqlite: page 0");
        }
        self.data
            .get((n - 1) * self.page_size..n * self.page_size)
            .ok_or_else(|| Error::Format(format!("sqlite: page {n} out of range")))
    }

    /// Payload of a table-leaf cell, following overflow pages.
    fn payload(&self, pg: &'a [u8], mut p: usize, len: usize) -> Result<Vec<u8>> {
        // `len` is a varint from the file: nothing is reserved for a payload
        // the database could not hold
        if len > self.data.len() {
            return fmt_err("sqlite: cell payload larger than the database");
        }
        let u = self.usable;
        let x = u - 35;
        let local = if len <= x {
            len
        } else {
            let m = ((u - 12) * 32 / 255) - 23;
            let k = m + ((len - m) % (u - 4));
            if k <= x {
                k
            } else {
                m
            }
        };
        let mut out = Vec::with_capacity(len);
        out.extend_from_slice(
            pg.get(p..p + local)
                .ok_or_else(|| Error::Format("sqlite: cell overruns page".into()))?,
        );
        p += local;
        let mut next = if local < len {
            be(pg
                .get(p..p + 4)
                .ok_or_else(|| Error::Format("sqlite: cell overruns page".into()))?)
                as u32
        } else {
            0
        };
        let mut guard = 0;
        while out.len() < len {
            if next == 0 || guard > 1_000_000 {
                return fmt_err("sqlite: broken overflow chain");
            }
            guard += 1;
            let op = self.page(next)?;
            next = be(&op[0..4]) as u32;
            let take = (len - out.len()).min(u - 4);
            out.extend_from_slice(&op[4..4 + take]);
        }
        Ok(out)
    }

    /// All (rowid, record) pairs of a table b-tree, in rowid order.
    fn scan(&self, root: u32) -> Result<Vec<(i64, Vec<u8>)>> {
        let mut out = Vec::new();
        let mut stack = vec![root];
        let mut visited = 0usize;
        while let Some(pn) = stack.pop() {
            visited += 1;
            if visited > self.data.len() / self.page_size + 1 {
                return fmt_err("sqlite: b-tree cycle");
            }
            let pg = self.page(pn)?;
            let h = if pn == 1 { 100 } else { 0 };
            let kind = pg[h];
            let ncells = be(&pg[h + 3..h + 5]) as usize;
            let hdr = if kind == 0x05 { 12 } else { 8 };
            // `ncells` is unchecked: the pointer array may claim to run past
            // the page
            let ptr = |i: usize| -> Result<usize> {
                pg.get(h + hdr + 2 * i..h + hdr + 2 * i + 2)
                    .map(|b| be(b) as usize)
                    .ok_or_else(|| {
                        Error::Format(format!("sqlite: page {pn} cell pointers overrun"))
                    })
            };
            match kind {
                0x0D => {
                    for i in 0..ncells {
                        let mut p = ptr(i)?;
                        let len = varint(pg, &mut p)? as usize;
                        let rowid = varint(pg, &mut p)? as i64;
                        out.push((rowid, self.payload(pg, p, len)?));
                    }
                }
                0x05 => {
                    // visit children left→right: push right-most first
                    stack.push(be(&pg[h + 8..h + 12]) as u32);
                    for i in (0..ncells).rev() {
                        let p = ptr(i)?;
                        let child = pg.get(p..p + 4).ok_or_else(|| {
                            Error::Format(format!("sqlite: page {pn} cell outside the page"))
                        })?;
                        stack.push(be(child) as u32);
                    }
                }
                k => {
                    return fmt_err(format!(
                        "sqlite: page {pn} has b-tree type {k:#x}, expected a table"
                    ))
                }
            }
        }
        Ok(out)
    }

    fn record(rec: &[u8]) -> Result<Vec<Value>> {
        let mut p = 0usize;
        let hlen = varint(rec, &mut p)? as usize;
        let mut types = Vec::new();
        while p < hlen {
            types.push(varint(rec, &mut p)?);
        }
        let mut d = hlen;
        let mut vals = Vec::with_capacity(types.len());
        let take = |d: &mut usize, n: usize| -> Result<&[u8]> {
            let s = d
                .checked_add(n)
                .and_then(|e| rec.get(*d..e))
                .ok_or_else(|| Error::Format("sqlite: record overrun".into()))?;
            *d += n;
            Ok(s)
        };
        for t in types {
            let v = match t {
                0 => Value::Null,
                1..=6 => {
                    let n = [0, 1, 2, 3, 4, 6, 8][t as usize];
                    let raw = be(take(&mut d, n)?);
                    let sh = 64 - 8 * n as u32;
                    Value::Int(((raw << sh) as i64) >> sh)
                }
                7 => Value::Real(f64::from_bits(be(take(&mut d, 8)?))),
                8 => Value::Int(0),
                9 => Value::Int(1),
                t if t >= 12 && t % 2 == 0 => {
                    Value::Blob(take(&mut d, ((t - 12) / 2) as usize)?.to_vec())
                }
                t if t >= 13 => Value::Text(
                    String::from_utf8_lossy(take(&mut d, ((t - 13) / 2) as usize)?).into_owned(),
                ),
                t => return fmt_err(format!("sqlite: serial type {t}")),
            };
            vals.push(v);
        }
        Ok(vals)
    }

    /// Names of all tables (from `sqlite_master`).
    pub fn tables(&self) -> Result<Vec<(String, u32, String)>> {
        let mut out = Vec::new();
        for (_, rec) in self.scan(1)? {
            let v = Self::record(&rec)?;
            if v.first().and_then(Value::as_str) == Some("table") {
                let name = v
                    .get(1)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let root = v.get(3).and_then(Value::as_i64).unwrap_or(0) as u32;
                let sql = v
                    .get(4)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                out.push((name, root, sql));
            }
        }
        Ok(out)
    }

    /// Read a whole table. The rowid-alias column (`INTEGER PRIMARY KEY`) is
    /// filled from the rowid.
    pub fn table(&self, name: &str) -> Result<Table> {
        let (_, root, sql) = self
            .tables()?
            .into_iter()
            .find(|(n, _, _)| n == name)
            .ok_or_else(|| Error::Format(format!("sqlite: no table {name}")))?;
        let (columns, rowid_col) = columns_of(&sql);
        let mut rows = Vec::new();
        for (rowid, rec) in self.scan(root)? {
            let mut v = Self::record(&rec)?;
            v.resize(columns.len().max(v.len()), Value::Null);
            if let Some(c) = rowid_col {
                if v[c] == Value::Null {
                    v[c] = Value::Int(rowid);
                }
            }
            rows.push(v);
        }
        Ok(Table {
            name: name.to_string(),
            columns,
            rows,
        })
    }
}

/// Column names from a `CREATE TABLE` statement, plus the rowid-alias column.
fn columns_of(sql: &str) -> (Vec<String>, Option<usize>) {
    let body = match (sql.find('('), sql.rfind(')')) {
        (Some(a), Some(b)) if b > a => &sql[a + 1..b],
        _ => return (Vec::new(), None),
    };
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, c) in body.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(&body[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&body[start..]);
    let mut cols = Vec::new();
    let mut rowid = None;
    for p in parts {
        let t = p.trim();
        let up = t.to_ascii_uppercase();
        if ["CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK"]
            .iter()
            .any(|k| up.starts_with(k))
        {
            continue;
        }
        let name = if let Some(rest) = t.strip_prefix('"') {
            rest.split('"').next().unwrap_or_default()
        } else if let Some(rest) = t.strip_prefix('[') {
            rest.split(']').next().unwrap_or_default()
        } else if let Some(rest) = t.strip_prefix('`') {
            rest.split('`').next().unwrap_or_default()
        } else {
            t.split_whitespace().next().unwrap_or_default()
        };
        let compact: String = up.split_whitespace().collect::<Vec<_>>().join(" ");
        if compact.contains("INTEGER") && compact.contains("PRIMARY KEY") {
            rowid = Some(cols.len());
        }
        cols.push(name.to_string());
    }
    (cols, rowid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_table_columns() {
        let (c, r) = columns_of(
            "CREATE TABLE \"T\" (\n \"mId\" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,\n \"mName\" TEXT NOT NULL DEFAULT '',\n \"mX\" REAL NULL,\n CONSTRAINT \"fk\" FOREIGN KEY (\"a\") REFERENCES \"B\" (\"mId\"))",
        );
        assert_eq!(c, vec!["mId", "mName", "mX"]);
        assert_eq!(r, Some(0));
    }

    /// A one-page database whose page 1 is a b-tree page of `kind`.
    fn one_page(kind: u8, ncells: u16) -> Vec<u8> {
        let mut d = vec![0u8; 512];
        d[..16].copy_from_slice(b"SQLite format 3\0");
        d[16..18].copy_from_slice(&512u16.to_be_bytes());
        d[56..60].copy_from_slice(&1u32.to_be_bytes());
        d[100] = kind;
        d[103..105].copy_from_slice(&ncells.to_be_bytes());
        d
    }

    #[test]
    fn corrupt_pages_are_errors_not_panics() {
        // more cells than the page has room for pointers
        for kind in [0x0D, 0x05] {
            let d = one_page(kind, u16::MAX);
            assert!(Db::open(&d).unwrap().tables().is_err());
        }
        // an interior cell pointer at the very end of the page
        let mut d = one_page(0x05, 1);
        d[112..114].copy_from_slice(&510u16.to_be_bytes());
        assert!(Db::open(&d).unwrap().tables().is_err());
        // a leaf cell declaring a payload far larger than the database
        let mut d = one_page(0x0D, 1);
        d[108..110].copy_from_slice(&200u16.to_be_bytes());
        d[200..206].copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF, 0x7F, 1]);
        assert!(Db::open(&d).unwrap().tables().is_err());
        // a leaf cell whose local part ends with the page, where the
        // overflow page number should follow (500 bytes: 39 stay local)
        let mut d = one_page(0x0D, 1);
        d[108..110].copy_from_slice(&470u16.to_be_bytes());
        d[470..473].copy_from_slice(&[0x83, 0x74, 1]);
        assert!(Db::open(&d).unwrap().tables().is_err());
    }
}
