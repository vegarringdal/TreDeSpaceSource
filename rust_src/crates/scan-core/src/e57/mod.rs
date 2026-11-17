//! ASTM E57 reader (E2807): header, XML, scans (`data3D`) with streamed
//! point decoding, and `images2D` with their encoded image blobs.
//!
//! The file is never loaded whole — the XML section and the binary sections
//! are pulled through the paged [`Paged`] layer on demand.

pub mod cv;
pub mod paged;
pub mod xml;

use serde::Serialize;

use crate::error::{fmt_err, Error, Result};
use crate::model::{Aabb, ImageFormat, PointBatch, Pose, CUBE_FACES};
use crate::source::Source;
use cv::{CvReader, Field};
use paged::Paged;
use xml::Elem;

pub const SIGNATURE: &[u8; 8] = b"ASTM-E57";

#[derive(Clone, Debug, Serialize)]
pub struct Header {
    pub version_major: u32,
    pub version_minor: u32,
    pub physical_length: u64,
    pub xml_physical_offset: u64,
    pub xml_logical_length: u64,
    pub page_size: u64,
}

impl Header {
    pub fn parse(b: &[u8; 48]) -> Result<Header> {
        if &b[0..8] != SIGNATURE {
            return fmt_err("not an E57 file (missing ASTM-E57 signature)");
        }
        let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        let u64_at = |o: usize| u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
        Ok(Header {
            version_major: u32_at(8),
            version_minor: u32_at(12),
            physical_length: u64_at(16),
            xml_physical_offset: u64_at(24),
            xml_logical_length: u64_at(32),
            page_size: u64_at(40),
        })
    }
}

/// Where an encoded image lives in the file.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct BlobRef {
    pub format: ImageFormat,
    /// Physical offset of the blob section header.
    pub file_offset: u64,
    /// Logical length of the blob payload.
    pub length: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Projection {
    /// Plain picture with no camera model.
    Visual,
    /// Pinhole camera (metres): cube faces from Leica are 90° pinhole images.
    Pinhole {
        focal_length: f64,
        pixel_width: f64,
        pixel_height: f64,
        principal_x: f64,
        principal_y: f64,
    },
    /// Equirectangular panorama; pixel sizes are radians.
    Spherical { pixel_width: f64, pixel_height: f64 },
    Cylindrical {
        radius: f64,
        principal_y: f64,
        pixel_width: f64,
        pixel_height: f64,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct Image {
    pub index: usize,
    pub guid: String,
    pub name: String,
    /// GUID of the `data3D` scan this image belongs to.
    pub scan_guid: Option<String>,
    /// Camera pose in the file's world frame (E57: camera looks down −Z,
    /// +X right, +Y up for pinhole images).
    pub pose: Pose,
    pub projection: Projection,
    pub width: u32,
    pub height: u32,
    pub image: Option<BlobRef>,
    pub mask: Option<BlobRef>,
    pub acquired: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Scan {
    pub index: usize,
    pub guid: String,
    pub name: String,
    pub description: String,
    /// Scan local → file world.
    pub pose: Pose,
    pub record_count: u64,
    /// Physical offset of the points CompressedVector section.
    pub points_offset: u64,
    #[serde(skip)]
    pub fields: Vec<Field>,
    pub field_names: Vec<String>,
    pub bounds: Option<Aabb>,
    pub intensity_limits: Option<(f64, f64)>,
    pub color_limits: Option<[(f64, f64); 3]>,
    pub sensor_vendor: String,
    pub sensor_model: String,
    pub sensor_software: String,
}

impl Scan {
    pub fn has_field(&self, name: &str) -> bool {
        self.fields.iter().any(|f| f.name == name)
    }
}

pub struct E57 {
    paged: Paged,
    pub header: Header,
    pub guid: String,
    pub library_version: String,
    pub root: Elem,
    pub scans: Vec<Scan>,
    pub images: Vec<Image>,
}

fn s(e: &Elem, name: &str) -> String {
    e.get(name)
        .and_then(Elem::as_str)
        .unwrap_or_default()
        .to_string()
}

fn f(e: &Elem, path: &str) -> Option<f64> {
    e.path(path).and_then(Elem::as_f64)
}

fn pose_of(e: &Elem) -> Pose {
    let Some(p) = e.get("pose") else {
        return Pose::IDENTITY;
    };
    let mut pose = Pose::IDENTITY;
    if p.get("rotation").is_some() {
        pose.rotation = [
            f(p, "rotation/w").unwrap_or(0.0),
            f(p, "rotation/x").unwrap_or(0.0),
            f(p, "rotation/y").unwrap_or(0.0),
            f(p, "rotation/z").unwrap_or(0.0),
        ];
    }
    if p.get("translation").is_some() {
        pose.translation = [
            f(p, "translation/x").unwrap_or(0.0),
            f(p, "translation/y").unwrap_or(0.0),
            f(p, "translation/z").unwrap_or(0.0),
        ];
    }
    pose
}

impl E57 {
    pub fn open(src: Source) -> Result<E57> {
        E57::open_with(src, false)
    }

    /// `verify`: check every page CRC-32C as it is read (≈1 GB/s cost).
    pub fn open_with(src: Source, verify: bool) -> Result<E57> {
        let mut hb = [0u8; 48];
        src.read_at(0, &mut hb)?;
        let header = Header::parse(&hb)?;
        if header.physical_length > src.len() {
            return Err(Error::Format(format!(
                "E57 header declares {} bytes but the file has {} — the file is truncated",
                header.physical_length,
                src.len()
            )));
        }
        let paged = Paged::new(src, header.page_size, verify)?;
        let xml_len = usize::try_from(header.xml_logical_length)
            .ok()
            .filter(|&n| n < 1 << 30)
            .ok_or_else(|| Error::Format("E57 XML section length implausible".into()))?;
        let xml_bytes =
            paged.read_logical_vec(paged.phys_to_logical(header.xml_physical_offset), xml_len)?;
        let text = std::str::from_utf8(&xml_bytes)
            .map_err(|_| Error::Format("E57 XML is not UTF-8".into()))?;
        let root = xml::parse(text)?;

        let mut scans = Vec::new();
        if let Some(d3) = root.get("data3D") {
            for (index, e) in d3.children().iter().enumerate() {
                scans.push(scan_of(index, e)?);
            }
        }
        let mut images = Vec::new();
        if let Some(i2) = root.get("images2D") {
            for (index, e) in i2.children().iter().enumerate() {
                images.push(image_of(index, e));
            }
        }
        Ok(E57 {
            guid: s(&root, "guid"),
            library_version: s(&root, "e57LibraryVersion"),
            paged,
            header,
            root,
            scans,
            images,
        })
    }

    /// Raw XML text of the file (for inspection).
    pub fn xml_text(&self) -> Result<String> {
        let b = self.paged.read_logical_vec(
            self.paged.phys_to_logical(self.header.xml_physical_offset),
            self.header.xml_logical_length as usize,
        )?;
        String::from_utf8(b).map_err(|_| Error::Format("E57 XML is not UTF-8".into()))
    }

    /// Read a blob payload (encoded image bytes).
    pub fn read_blob(&self, blob: &BlobRef) -> Result<Vec<u8>> {
        let sec = self.paged.phys_to_logical(blob.file_offset);
        let mut hdr = [0u8; 16];
        self.paged.read_logical(sec, &mut hdr)?;
        if hdr[0] != 0 {
            return fmt_err(format!(
                "E57 blob section id {} at {}",
                hdr[0], blob.file_offset
            ));
        }
        // the length comes from the XML: checked against the file before
        // anything is allocated for it
        let start = sec.saturating_add(16);
        if blob.length > self.paged.logical_len().saturating_sub(start) {
            return fmt_err(format!(
                "E57 blob at {} declares {} bytes, more than the file holds",
                blob.file_offset, blob.length
            ));
        }
        let len =
            usize::try_from(blob.length).map_err(|_| Error::Format("blob too large".into()))?;
        self.paged.read_logical_vec(start, len)
    }

    /// Stream a scan's points. `apply_pose` transforms them into the file's
    /// world frame; otherwise they stay in the scan's local frame.
    pub fn points(&self, scan: usize, apply_pose: bool) -> Result<ScanPoints<'_>> {
        let sc = self
            .scans
            .get(scan)
            .ok_or_else(|| Error::Format(format!("no scan {scan}")))?;
        ScanPoints::new(self, sc, apply_pose)
    }

    /// Images belonging to a scan (by `associatedData3DGuid`).
    pub fn images_of(&self, scan: usize) -> impl Iterator<Item = &Image> {
        let guid = self
            .scans
            .get(scan)
            .map(|s| s.guid.clone())
            .unwrap_or_default();
        self.images
            .iter()
            .filter(move |i| i.scan_guid.as_deref() == Some(guid.as_str()))
    }

    pub fn total_points(&self) -> u64 {
        self.scans.iter().map(|s| s.record_count).sum()
    }

    /// Group images taken from the same position into stations, and
    /// recognise six 90° pinhole images as a cube map (Leica exports write
    /// one cube per setup even when all scans are merged into one `data3D`).
    pub fn stations(&self) -> Vec<Station> {
        let mut out: Vec<Station> = Vec::new();
        for img in &self.images {
            let t = img.pose.translation;
            match out
                .iter_mut()
                .find(|s| (0..3).all(|k| (s.position[k] - t[k]).abs() < 1e-6))
            {
                Some(s) => s.images.push(img.index),
                None => out.push(Station {
                    position: t,
                    images: vec![img.index],
                    pose: None,
                    cube: None,
                }),
            }
        }
        for st in &mut out {
            st.detect_cube(&self.images);
        }
        out
    }
}

/// Images sharing one projection centre.
#[derive(Clone, Debug, Serialize)]
pub struct Station {
    pub position: [f64; 3],
    pub images: Vec<usize>,
    /// Station frame → file world, when the images form a cube.
    pub pose: Option<Pose>,
    /// Image index per face, in [`CUBE_FACES`] order.
    pub cube: Option<[usize; 6]>,
}

impl Station {
    fn detect_cube(&mut self, images: &[Image]) {
        if self.images.len() != 6 {
            return;
        }
        let square90 = |im: &Image| match im.projection {
            Projection::Pinhole {
                focal_length,
                pixel_width,
                ..
            } if im.width == im.height && focal_length > 0.0 => {
                let half = 0.5 * im.width as f64 * pixel_width;
                ((half / focal_length).atan().to_degrees() - 45.0).abs() < 0.5
            }
            _ => false,
        };
        if !self.images.iter().all(|&i| square90(&images[i])) {
            return;
        }
        // the down-looking face has the identity face rotation, so its pose
        // rotation is the station's; classify the rest in that frame
        let mut slots = [usize::MAX; 6];
        let views: Vec<[f64; 3]> = self
            .images
            .iter()
            .map(|&i| images[i].pose.matrix3())
            .map(|m| [-m[0][2], -m[1][2], -m[2][2]])
            .collect();
        let Some(down) = views.iter().position(|v| v[2] < -0.9) else {
            return;
        };
        let station = Pose {
            rotation: images[self.images[down]].pose.rotation,
            translation: self.position,
        };
        let inv = station.inverse();
        for (k, &i) in self.images.iter().enumerate() {
            let w = views[k];
            let local = inv.apply([
                w[0] + self.position[0],
                w[1] + self.position[1],
                w[2] + self.position[2],
            ]);
            let Some(f) = CUBE_FACES
                .iter()
                .position(|f| (0..3).map(|a| f.view[a] * local[a]).sum::<f64>() > 0.99)
            else {
                return;
            };
            if slots[f] != usize::MAX {
                return;
            }
            slots[f] = i;
        }
        self.pose = Some(station);
        self.cube = Some(slots);
    }
}

fn scan_of(index: usize, e: &Elem) -> Result<Scan> {
    let Some(Elem::CompressedVector {
        file_offset,
        record_count,
        prototype,
        ..
    }) = e.get("points")
    else {
        return fmt_err(format!(
            "E57 data3D[{index}] has no points CompressedVector"
        ));
    };
    let fields = cv::fields_of(prototype)?;
    let bounds = e.get("cartesianBounds").map(|b| Aabb {
        min: [
            f(b, "xMinimum").unwrap_or(0.0),
            f(b, "yMinimum").unwrap_or(0.0),
            f(b, "zMinimum").unwrap_or(0.0),
        ],
        max: [
            f(b, "xMaximum").unwrap_or(0.0),
            f(b, "yMaximum").unwrap_or(0.0),
            f(b, "zMaximum").unwrap_or(0.0),
        ],
    });
    let intensity_limits = e.get("intensityLimits").map(|l| {
        (
            f(l, "intensityMinimum").unwrap_or(0.0),
            f(l, "intensityMaximum").unwrap_or(0.0),
        )
    });
    let color_limits = e.get("colorLimits").map(|l| {
        let g = |c: &str| {
            (
                f(l, &format!("color{c}Minimum")).unwrap_or(0.0),
                f(l, &format!("color{c}Maximum")).unwrap_or(255.0),
            )
        };
        [g("Red"), g("Green"), g("Blue")]
    });
    Ok(Scan {
        index,
        guid: s(e, "guid"),
        name: s(e, "name"),
        description: s(e, "description"),
        pose: pose_of(e),
        record_count: *record_count,
        points_offset: *file_offset,
        field_names: fields.iter().map(|f| f.name.clone()).collect(),
        fields,
        bounds,
        intensity_limits,
        color_limits,
        sensor_vendor: s(e, "sensorVendor"),
        sensor_model: s(e, "sensorModel"),
        sensor_software: s(e, "sensorSoftwareVersion"),
    })
}

fn blob_of(rep: &Elem, png: &str, jpeg: &str) -> Option<BlobRef> {
    for (name, fmt) in [(jpeg, ImageFormat::Jpeg), (png, ImageFormat::Png)] {
        if let Some(Elem::Blob {
            file_offset,
            length,
        }) = rep.get(name)
        {
            return Some(BlobRef {
                format: fmt,
                file_offset: *file_offset,
                length: *length,
            });
        }
    }
    None
}

fn image_of(index: usize, e: &Elem) -> Image {
    let mut projection = Projection::Visual;
    let mut rep_elem = None;
    for rep in [
        "pinholeRepresentation",
        "sphericalRepresentation",
        "cylindricalRepresentation",
        "visualReferenceRepresentation",
    ] {
        if let Some(r) = e.get(rep) {
            rep_elem = Some(r);
            projection = match rep {
                "pinholeRepresentation" => Projection::Pinhole {
                    focal_length: f(r, "focalLength").unwrap_or(0.0),
                    pixel_width: f(r, "pixelWidth").unwrap_or(0.0),
                    pixel_height: f(r, "pixelHeight").unwrap_or(0.0),
                    principal_x: f(r, "principalPointX").unwrap_or(0.0),
                    principal_y: f(r, "principalPointY").unwrap_or(0.0),
                },
                "sphericalRepresentation" => Projection::Spherical {
                    pixel_width: f(r, "pixelWidth").unwrap_or(0.0),
                    pixel_height: f(r, "pixelHeight").unwrap_or(0.0),
                },
                "cylindricalRepresentation" => Projection::Cylindrical {
                    radius: f(r, "radius").unwrap_or(0.0),
                    principal_y: f(r, "principalPointY").unwrap_or(0.0),
                    pixel_width: f(r, "pixelWidth").unwrap_or(0.0),
                    pixel_height: f(r, "pixelHeight").unwrap_or(0.0),
                },
                _ => Projection::Visual,
            };
            break;
        }
    }
    let (image, mask, width, height) = match rep_elem {
        Some(r) => (
            blob_of(r, "pngImage", "jpegImage"),
            match r.get("imageMask") {
                Some(Elem::Blob {
                    file_offset,
                    length,
                }) => Some(BlobRef {
                    format: ImageFormat::Png,
                    file_offset: *file_offset,
                    length: *length,
                }),
                _ => None,
            },
            f(r, "imageWidth").unwrap_or(0.0) as u32,
            f(r, "imageHeight").unwrap_or(0.0) as u32,
        ),
        None => (None, None, 0, 0),
    };
    Image {
        index,
        guid: s(e, "guid"),
        name: s(e, "name"),
        scan_guid: e
            .get("associatedData3DGuid")
            .and_then(Elem::as_str)
            .map(str::to_string),
        pose: pose_of(e),
        projection,
        width,
        height,
        image,
        mask,
        acquired: f(e, "acquisitionDateTime/dateTimeValue"),
    }
}

/// Column → [`PointBatch`] conversion for one scan (coordinate system,
/// pose, colour / intensity normalisation, invalid flags).
#[derive(Clone)]
struct Converter {
    pose: Option<Pose>,
    scan_index: u16,
    ix: Layout,
    intensity: Option<(f64, f64)>,
    color: Option<[(f64, f64); 3]>,
}

#[derive(Default, Clone)]
struct Layout {
    cart: Option<[usize; 3]>,
    sph: Option<[usize; 3]>,
    cart_invalid: Option<usize>,
    sph_invalid: Option<usize>,
    intensity: Option<usize>,
    intensity_invalid: Option<usize>,
    rgb: Option<[usize; 3]>,
    color_invalid: Option<usize>,
}

impl Converter {
    fn new(sc: &Scan, apply_pose: bool) -> Result<Self> {
        let pos = |n: &str| sc.fields.iter().position(|f| f.name == n);
        let tri = |a, b, c| Some([pos(a)?, pos(b)?, pos(c)?]);
        let ix = Layout {
            cart: tri("cartesianX", "cartesianY", "cartesianZ"),
            sph: tri("sphericalRange", "sphericalAzimuth", "sphericalElevation"),
            cart_invalid: pos("cartesianInvalidState"),
            sph_invalid: pos("sphericalInvalidState"),
            intensity: pos("intensity"),
            intensity_invalid: pos("isIntensityInvalid"),
            rgb: tri("colorRed", "colorGreen", "colorBlue"),
            color_invalid: pos("isColorInvalid"),
        };
        if ix.cart.is_none() && ix.sph.is_none() {
            return Err(Error::Unsupported(format!(
                "E57 scan {} has no cartesian or spherical coordinates",
                sc.index
            )));
        }
        let intensity = ix.intensity.map(|i| {
            let fl = &sc.fields[i];
            match sc.intensity_limits {
                Some((lo, hi)) if hi > lo => (lo, hi),
                // a field without declared bounds has its type's whole
                // range, which would flatten every value to one
                _ if fl.max < 1e12 && fl.min > -1e12 => (fl.min, fl.max),
                _ => (0.0, 1.0),
            }
        });
        let color = ix.rgb.map(|rgb| {
            let mut lim = [(0.0, 255.0); 3];
            for k in 0..3 {
                let fl = &sc.fields[rgb[k]];
                lim[k] = match sc.color_limits {
                    Some(cl) if cl[k].1 > cl[k].0 => cl[k],
                    _ if fl.max > fl.min && fl.max < 1e12 => (fl.min, fl.max),
                    _ => (0.0, 255.0),
                };
            }
            lim
        });
        Ok(Converter {
            pose: (apply_pose && !sc.pose.is_identity()).then_some(sc.pose),
            scan_index: sc.index as u16,
            ix,
            intensity,
            color,
        })
    }

    /// Points flagged invalid (`cartesianInvalidState != 0` etc.) are
    /// dropped, and so are points with a NaN or infinite coordinate: every
    /// reader and every pass of a cook goes through here, so they all see
    /// the same points.
    #[allow(clippy::needless_range_loop)] // one index across many columns
    fn batch(&self, c: &[Vec<f64>], n: usize) -> PointBatch {
        let ix = &self.ix;
        let mut b = PointBatch {
            positions: Vec::with_capacity(n),
            colors: self.color.map(|_| Vec::with_capacity(n)),
            intensity: self.intensity.map(|_| Vec::with_capacity(n)),
            setup: Some(Vec::with_capacity(n)),
        };
        let r3 = self.pose.map(|p| (p.matrix3(), p.translation));
        for i in 0..n {
            let p = if let Some([x, y, z]) = ix
                .cart
                .filter(|_| ix.cart_invalid.is_none_or(|k| c[k][i] == 0.0))
            {
                [c[x][i], c[y][i], c[z][i]]
            } else if let Some([r, az, el]) = ix.sph {
                if ix.sph_invalid.is_some_and(|k| c[k][i] != 0.0) {
                    continue;
                }
                let (r, az, el) = (c[r][i], c[az][i], c[el][i]);
                [
                    r * el.cos() * az.cos(),
                    r * el.cos() * az.sin(),
                    r * el.sin(),
                ]
            } else {
                continue;
            };
            let p = match r3 {
                Some((m, t)) => [
                    m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + t[0],
                    m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + t[1],
                    m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + t[2],
                ],
                None => p,
            };
            if !p.iter().all(|v| v.is_finite()) {
                continue;
            }
            b.positions.push(p);
            if let (Some(out), Some([r, g, bl]), Some(lim)) =
                (b.colors.as_mut(), ix.rgb, self.color)
            {
                let invalid = ix.color_invalid.is_some_and(|k| c[k][i] != 0.0);
                let q = |v: f64, (lo, hi): (f64, f64)| {
                    (((v - lo) / (hi - lo)) * 255.0).round().clamp(0.0, 255.0) as u8
                };
                out.push(if invalid {
                    [0, 0, 0]
                } else {
                    [q(c[r][i], lim[0]), q(c[g][i], lim[1]), q(c[bl][i], lim[2])]
                });
            }
            if let (Some(out), Some(k), Some((lo, hi))) =
                (b.intensity.as_mut(), ix.intensity, self.intensity)
            {
                let invalid = ix.intensity_invalid.is_some_and(|q| c[q][i] != 0.0);
                out.push(if invalid || hi <= lo {
                    0.0
                } else {
                    (((c[k][i] - lo) / (hi - lo)) as f32).clamp(0.0, 1.0)
                });
            }
            if let Some(s) = b.setup.as_mut() {
                s.push(self.scan_index);
            }
        }
        b
    }
}

/// Streams one scan's points as [`PointBatch`]es, in file order.
pub struct ScanPoints<'a> {
    cv: CvReader<'a>,
    cols: Vec<Vec<f64>>,
    conv: Converter,
    pub batch_size: usize,
}

impl<'a> ScanPoints<'a> {
    fn new(e57: &'a E57, sc: &Scan, apply_pose: bool) -> Result<Self> {
        Ok(ScanPoints {
            cv: CvReader::new(
                &e57.paged,
                sc.points_offset,
                sc.record_count,
                sc.fields.clone(),
            )?,
            cols: Vec::new(),
            conv: Converter::new(sc, apply_pose)?,
            batch_size: 1 << 20,
        })
    }

    pub fn remaining(&self) -> u64 {
        self.cv.remaining()
    }

    /// Next batch, `None` at the end.
    pub fn next_batch(&mut self) -> Result<Option<PointBatch>> {
        let n = self.cv.read(self.batch_size, &mut self.cols)?;
        if n == 0 {
            return Ok(None);
        }
        Ok(Some(self.conv.batch(&self.cols, n)))
    }
}

/// One scan prepared for decoding record ranges independently of each other
/// (threads natively, sub-workers in the browser): the packet table is
/// walked once — or handed over from whoever walked it — then any
/// `[r0, r1)` decodes on its own. Owns what it needs, so it outlives the
/// borrow of the [`E57`].
pub struct RangeDecoder {
    paged: Paged,
    fields: Vec<cv::Field>,
    record_count: u64,
    conv: Converter,
    table: cv::PacketTable,
}

impl RangeDecoder {
    pub fn records(&self) -> u64 {
        self.record_count
    }

    pub fn table(&self) -> &cv::PacketTable {
        &self.table
    }

    /// Decode records `[r0, r1)`.
    pub fn decode(&self, r0: u64, r1: u64) -> Result<PointBatch> {
        let cols = cv::decode_range(&self.paged, &self.table, &self.fields, r0, r1)?;
        Ok(self.conv.batch(&cols, (r1 - r0) as usize))
    }
}

impl E57 {
    /// Prepare `scan` for range decoding; `table` = a packet table walked
    /// earlier ([`RangeDecoder::table`]), `None` walks the packet headers now.
    pub fn range_decoder(
        &self,
        scan: usize,
        apply_pose: bool,
        table: Option<cv::PacketTable>,
        progress: &mut dyn FnMut(f64),
    ) -> Result<RangeDecoder> {
        let sc = self
            .scans
            .get(scan)
            .ok_or_else(|| Error::Format(format!("no scan {scan}")))?;
        let table = match table {
            Some(t) if t.fields == sc.fields.len() => t,
            Some(_) => return Err(Error::Format("packet table of another scan".into())),
            None => {
                cv::packet_table_with(&self.paged, sc.points_offset, sc.fields.len(), progress)?
            }
        };
        Ok(RangeDecoder {
            paged: self.paged.clone(),
            fields: sc.fields.clone(),
            record_count: sc.record_count,
            conv: Converter::new(sc, apply_pose)?,
            table,
        })
    }

    /// Decode every point of a scan with `threads` workers and hand the
    /// batches to `f` on the calling thread, **in no particular order**.
    /// Workers decode independent record ranges (see
    /// [`cv::decode_range`]); with `threads <= 1` (or on wasm) this is the
    /// sequential reader.
    pub fn for_each_batch(
        &self,
        scan: usize,
        apply_pose: bool,
        threads: usize,
        mut f: impl FnMut(PointBatch) -> Result<()>,
    ) -> Result<()> {
        let sc = self
            .scans
            .get(scan)
            .ok_or_else(|| Error::Format(format!("no scan {scan}")))?;
        if threads <= 1 || cfg!(target_arch = "wasm32") {
            let mut r = self.points(scan, apply_pose)?;
            while let Some(b) = r.next_batch()? {
                f(b)?;
            }
            return Ok(());
        }
        let conv = Converter::new(sc, apply_pose)?;
        let table = cv::packet_table(&self.paged, sc.points_offset, sc.fields.len())?;
        const RANGE: u64 = 1 << 20;
        let next = std::sync::atomic::AtomicU64::new(0);
        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<PointBatch>>(threads * 2);
        std::thread::scope(|s| -> Result<()> {
            for _ in 0..threads {
                let tx = tx.clone();
                let (table, conv, next) = (&table, &conv, &next);
                s.spawn(move || loop {
                    let r0 = next.fetch_add(RANGE, std::sync::atomic::Ordering::Relaxed);
                    if r0 >= sc.record_count {
                        break;
                    }
                    let r1 = (r0 + RANGE).min(sc.record_count);
                    let out = cv::decode_range(&self.paged, table, &sc.fields, r0, r1)
                        .map(|cols| conv.batch(&cols, (r1 - r0) as usize));
                    let failed = out.is_err();
                    if tx.send(out).is_err() || failed {
                        break;
                    }
                });
            }
            drop(tx);
            for b in rx {
                if let Err(e) = b.and_then(&mut f) {
                    next.store(u64::MAX / 2, std::sync::atomic::Ordering::Relaxed);
                    return Err(e);
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cv::Codec;

    fn scan(fields: &[(&str, Codec, f64, f64)], intensity_limits: Option<(f64, f64)>) -> Scan {
        let fields: Vec<Field> = fields
            .iter()
            .map(|(name, codec, min, max)| Field {
                name: name.to_string(),
                codec: codec.clone(),
                min: *min,
                max: *max,
            })
            .collect();
        Scan {
            index: 0,
            guid: String::new(),
            name: String::new(),
            description: String::new(),
            pose: Pose::IDENTITY,
            record_count: 0,
            points_offset: 0,
            field_names: fields.iter().map(|f| f.name.clone()).collect(),
            fields,
            bounds: None,
            intensity_limits,
            color_limits: None,
            sensor_vendor: String::new(),
            sensor_model: String::new(),
            sensor_software: String::new(),
        }
    }

    const XYZ: [(&str, Codec, f64, f64); 3] = [
        ("cartesianX", Codec::F64, f64::MIN, f64::MAX),
        ("cartesianY", Codec::F64, f64::MIN, f64::MAX),
        ("cartesianZ", Codec::F64, f64::MIN, f64::MAX),
    ];

    #[test]
    fn non_finite_points_are_dropped() {
        let mut fields = XYZ.to_vec();
        fields.push(("intensity", Codec::F32, 0.0, 1.0));
        let conv = Converter::new(&scan(&fields, None), true).unwrap();
        let cols = vec![
            vec![1.0, f64::NAN, 3.0, 4.0, 5.0],
            vec![1.0, 2.0, f64::INFINITY, 4.0, 5.0],
            vec![1.0, 2.0, 3.0, f64::NEG_INFINITY, 5.0],
            vec![0.1, 0.2, 0.3, 0.4, 0.5],
        ];
        let b = conv.batch(&cols, 5);
        assert_eq!(b.positions, vec![[1.0; 3], [5.0; 3]]);
        // the attributes stay with their points
        assert_eq!(b.intensity, Some(vec![0.1, 0.5]));
        assert_eq!(b.setup.map(|s| s.len()), Some(2));
    }

    #[test]
    fn intensity_without_limits() {
        let intensity = |codec: Codec, min: f64, max: f64, limits| {
            let mut fields = XYZ.to_vec();
            fields.push(("intensity", codec, min, max));
            let conv = Converter::new(&scan(&fields, limits), false).unwrap();
            let cols = vec![vec![0.0], vec![0.0], vec![0.0], vec![0.25]];
            conv.batch(&cols, 1).intensity.unwrap()[0]
        };
        // a Float without bounds has the whole range of its type: read as 0..1
        assert_eq!(intensity(Codec::F64, f64::MIN, f64::MAX, None), 0.25);
        assert_eq!(
            intensity(Codec::F32, f32::MIN as f64, f32::MAX as f64, None),
            0.25
        );
        // declared bounds and intensityLimits still decide
        assert_eq!(intensity(Codec::F32, 0.0, 0.5, None), 0.5);
        assert_eq!(
            intensity(Codec::F64, f64::MIN, f64::MAX, Some((0.0, 2.0))),
            0.125
        );
    }
}
