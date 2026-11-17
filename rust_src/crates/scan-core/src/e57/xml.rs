//! E57 XML section → typed element tree (ASTM E2807 §8: Structure, Vector,
//! CompressedVector, Integer, ScaledInteger, Float, String, Blob).

use crate::error::{fmt_err, Error, Result};

#[derive(Clone, Debug)]
pub enum Elem {
    Structure(Vec<(String, Elem)>),
    Vector(Vec<Elem>),
    CompressedVector {
        file_offset: u64,
        record_count: u64,
        prototype: Box<Elem>,
        codecs: Vec<Elem>,
    },
    Integer {
        value: i64,
        min: i64,
        max: i64,
    },
    ScaledInteger {
        raw: i64,
        min: i64,
        max: i64,
        scale: f64,
        offset: f64,
    },
    Float {
        value: f64,
        double: bool,
        min: f64,
        max: f64,
    },
    String(String),
    Blob {
        file_offset: u64,
        length: u64,
    },
}

impl Elem {
    /// Child of a Structure by name.
    pub fn get(&self, name: &str) -> Option<&Elem> {
        match self {
            Elem::Structure(c) => c.iter().find(|(n, _)| n == name).map(|(_, e)| e),
            _ => None,
        }
    }

    /// Follow a `/`-separated path of Structure children.
    pub fn path(&self, path: &str) -> Option<&Elem> {
        path.split('/').try_fold(self, |e, seg| e.get(seg))
    }

    pub fn children(&self) -> &[Elem] {
        match self {
            Elem::Vector(v) => v,
            _ => &[],
        }
    }

    /// Numeric value of Integer / ScaledInteger / Float.
    pub fn as_f64(&self) -> Option<f64> {
        match *self {
            Elem::Integer { value, .. } => Some(value as f64),
            Elem::ScaledInteger {
                raw, scale, offset, ..
            } => Some(raw as f64 * scale + offset),
            Elem::Float { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match *self {
            Elem::Integer { value, .. } => Some(value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Elem::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            Elem::Structure(_) => "Structure",
            Elem::Vector(_) => "Vector",
            Elem::CompressedVector { .. } => "CompressedVector",
            Elem::Integer { .. } => "Integer",
            Elem::ScaledInteger { .. } => "ScaledInteger",
            Elem::Float { .. } => "Float",
            Elem::String(_) => "String",
            Elem::Blob { .. } => "Blob",
        }
    }
}

/// Parse the XML section text into the `e57Root` element.
pub fn parse(text: &str) -> Result<Elem> {
    let doc = roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: u32::MAX,
            ..Default::default()
        },
    )
    .map_err(|e| Error::Format(format!("E57 XML: {e}")))?;
    let root = doc.root_element();
    if root.tag_name().name() != "e57Root" {
        return fmt_err(format!(
            "E57 XML root is <{}>, expected <e57Root>",
            root.tag_name().name()
        ));
    }
    elem(root)
}

fn attr_i64(n: roxmltree::Node, a: &str, default: i64) -> Result<i64> {
    match n.attribute(a) {
        None => Ok(default),
        Some(s) => parse_int(s),
    }
}

fn attr_f64(n: roxmltree::Node, a: &str, default: f64) -> Result<f64> {
    match n.attribute(a) {
        None => Ok(default),
        Some(s) => parse_float(s),
    }
}

fn parse_int(s: &str) -> Result<i64> {
    let t = s.trim();
    if t.is_empty() {
        return Ok(0);
    }
    t.parse::<i64>()
        .map_err(|_| Error::Format(format!("E57 XML: bad integer {t:?}")))
}

fn parse_float(s: &str) -> Result<f64> {
    let t = s.trim();
    if t.is_empty() {
        return Ok(0.0);
    }
    t.parse::<f64>()
        .map_err(|_| Error::Format(format!("E57 XML: bad float {t:?}")))
}

fn text(n: roxmltree::Node) -> String {
    // concatenated text + CDATA children
    n.children()
        .filter(|c| c.is_text())
        .filter_map(|c| c.text())
        .collect()
}

fn elem(n: roxmltree::Node) -> Result<Elem> {
    let ty = n.attribute("type").unwrap_or("");
    let kids = || n.children().filter(|c| c.is_element());
    Ok(match ty {
        "Structure" => {
            let mut v = Vec::new();
            for c in kids() {
                v.push((c.tag_name().name().to_string(), elem(c)?));
            }
            Elem::Structure(v)
        }
        "Vector" => Elem::Vector(kids().map(elem).collect::<Result<_>>()?),
        "CompressedVector" => {
            let mut prototype = None;
            let mut codecs = Vec::new();
            for c in kids() {
                match c.tag_name().name() {
                    "prototype" => prototype = Some(elem(c)?),
                    "codecs" => codecs = elem(c)?.children().to_vec(),
                    _ => {}
                }
            }
            Elem::CompressedVector {
                file_offset: attr_i64(n, "fileOffset", 0)? as u64,
                record_count: attr_i64(n, "recordCount", 0)? as u64,
                prototype: Box::new(prototype.ok_or_else(|| {
                    Error::Format("E57 CompressedVector without prototype".into())
                })?),
                codecs,
            }
        }
        "Integer" => Elem::Integer {
            value: parse_int(&text(n))?,
            min: attr_i64(n, "minimum", i64::MIN)?,
            max: attr_i64(n, "maximum", i64::MAX)?,
        },
        "ScaledInteger" => Elem::ScaledInteger {
            raw: parse_int(&text(n))?,
            min: attr_i64(n, "minimum", i64::MIN)?,
            max: attr_i64(n, "maximum", i64::MAX)?,
            scale: attr_f64(n, "scale", 1.0)?,
            offset: attr_f64(n, "offset", 0.0)?,
        },
        "Float" => {
            let double = n.attribute("precision").unwrap_or("double") != "single";
            let (lo, hi) = if double {
                (f64::MIN, f64::MAX)
            } else {
                (f32::MIN as f64, f32::MAX as f64)
            };
            Elem::Float {
                value: parse_float(&text(n))?,
                double,
                min: attr_f64(n, "minimum", lo)?,
                max: attr_f64(n, "maximum", hi)?,
            }
        }
        "String" => Elem::String(text(n)),
        "Blob" => Elem::Blob {
            file_offset: attr_i64(n, "fileOffset", 0)? as u64,
            length: attr_i64(n, "length", 0)? as u64,
        },
        other => {
            return fmt_err(format!(
                "E57 XML: <{}> has unknown type {other:?}",
                n.tag_name().name()
            ))
        }
    })
}
