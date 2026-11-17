//! Cooks of real scan files with damage patched in on the way from disk
//! (the files are not committed — see `scan-core/tests/samples.rs`; set
//! `SCAN_SAMPLES` to their folder). Each test skips when its file is missing.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use scan_cook::format::{Header, FLAG_NORMALS};
use scan_cook::reader::Tdpp;
use scan_cook::writer::Sink;
use scan_cook::CookOptions;
use scan_core::e57::{Projection, E57};
use scan_core::lgsx::{CubeKind, Lgsx};
use scan_core::model::Pose;
use scan_core::source::{open_file, ReadAt, SliceSource, Source};

fn sample(name: &str) -> Option<PathBuf> {
    let dir = std::env::var_os("SCAN_SAMPLES")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../scanSamples"));
    let p = dir.join(name);
    if p.exists() {
        Some(p)
    } else {
        eprintln!("skip: {} not present", p.display());
        None
    }
}

/// A source with a few bytes overwritten.
struct Patched {
    inner: Source,
    at: u64,
    bytes: Vec<u8>,
}

impl ReadAt for Patched {
    fn len(&self) -> u64 {
        self.inner.len()
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> scan_core::Result<()> {
        self.inner.read_at(offset, buf)?;
        for (i, b) in self.bytes.iter().enumerate() {
            let p = self.at + i as u64;
            if p >= offset && p - offset < buf.len() as u64 {
                buf[(p - offset) as usize] = *b;
            }
        }
        Ok(())
    }
}

fn patched(path: &PathBuf, at: u64, bytes: &[u8]) -> Source {
    Arc::new(Patched {
        inner: open_file(path).unwrap(),
        at,
        bytes: bytes.to_vec(),
    })
}

struct MemSink(Arc<Mutex<Vec<u8>>>);

impl Sink for MemSink {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(())
    }
    fn write_at(&mut self, offset: u64, bytes: &[u8]) -> std::io::Result<()> {
        let o = offset as usize;
        self.0.lock().unwrap()[o..o + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Run a cook into memory: its header, the file as the reader sees it, and
/// the log lines.
fn cooked(
    cook: impl FnOnce(Box<dyn Sink>, &(dyn Fn(&str) + Sync)) -> scan_cook::Result<Header>,
) -> (Header, Tdpp, Vec<String>) {
    let out = Arc::new(Mutex::new(Vec::new()));
    let lines = Mutex::new(Vec::new());
    let h = cook(Box::new(MemSink(out.clone())), &|m: &str| {
        lines.lock().unwrap().push(m.to_string())
    })
    .unwrap();
    let bytes = std::mem::take(&mut *out.lock().unwrap());
    let t = Tdpp::open(Arc::new(SliceSource::new(bytes))).unwrap();
    (h, t, lines.into_inner().unwrap())
}

/// A metadata pose is `want` (the JSON reader may be an ulp off).
fn assert_pose(v: &serde_json::Value, want: &Pose) {
    let got: Vec<f64> = ["rotation", "translation"]
        .iter()
        .flat_map(|k| v[k].as_array().unwrap())
        .map(|x| x.as_f64().unwrap())
        .collect();
    let want: Vec<f64> = want
        .rotation
        .iter()
        .chain(&want.translation)
        .copied()
        .collect();
    assert_eq!(got.len(), want.len());
    assert!(
        got.iter().zip(&want).all(|(a, b)| (a - b).abs() < 1e-12),
        "{got:?} is not {want:?}"
    );
}

const BLK: &str = "BLK360G1_Indoor_Office_classified 1.lgsx";
const FMB_E57: &str = "FMB-Bridge-Partial.e57";

/// A cube section that cannot be parsed costs that setup its panorama, not
/// the cook; and the normals flag says what the nodes hold.
#[test]
fn lgsx_cook_survives_a_broken_panorama() {
    let Some(p) = sample(BLK) else { return };
    let sec = {
        let l = Lgsx::open(open_file(&p).unwrap()).unwrap();
        l.cube_section(&l.setups[0], CubeKind::Camera)
            .unwrap()
            .offset
    };
    let l = Lgsx::open(patched(&p, sec, b"XXXX")).unwrap();
    let o = CookOptions {
        normals: true,
        ..Default::default()
    };
    let (h, t, lines) = cooked(|sink, log| scan_cook::lgsx::cook(&l, sink, &o, log));
    assert_eq!(h.point_count, l.info.point_count);
    assert!(lines
        .iter()
        .any(|m| m.starts_with("warning: panorama of setup") && m.contains(&l.setups[0].name)));
    assert!(lines.last().unwrap().ends_with(", 1 panorama left out"));
    let setups = t.meta["setups"].as_array().unwrap();
    assert_eq!(setups.len(), l.setups.len());
    assert!(setups[0]["panorama"].is_null());
    assert!(setups[1..].iter().all(|s| s["panorama"]["kind"] == "cube"));

    let source_has_normals = l.read_node(&l.nodes[0]).unwrap().normal_code.is_some();
    assert_eq!(h.flags & FLAG_NORMALS != 0, source_has_normals);
    let first = (0..t.nodes.len())
        .find(|&i| t.nodes[i].point_count > 0)
        .unwrap();
    assert_eq!(
        !t.decode(first).unwrap().normals.is_empty(),
        source_has_normals
    );
}

/// The points do not need the project database: without it the scan opens,
/// with no setups.
#[test]
fn lgsx_opens_without_its_database() {
    let Some(p) = sample(BLK) else { return };
    let (db, points) = {
        let l = Lgsx::open(open_file(&p).unwrap()).unwrap();
        assert!(!l.setups.is_empty());
        (
            l.container.section("ProjectDatabase").unwrap().offset,
            l.info.point_count,
        )
    };
    let l = Lgsx::open(patched(&p, db, b"XXXX")).unwrap();
    assert_eq!(l.info.point_count, points);
    assert!(l.setups.is_empty());
    assert!(l.coord_report.iter().any(|m| m.contains("setups not read")));
}

/// The first records of every scan — enough for the setups, quick to cook.
fn head(mut e: E57) -> E57 {
    for sc in &mut e.scans {
        sc.record_count = sc.record_count.min(200_000);
    }
    e
}

/// Two scans, each with a cube at the scanner. One scan is given the
/// identity pose (points already in world coordinates, its images found by
/// GUID): its setup takes the station's frame. The other keeps its pose, and
/// loses its panorama to an unreadable image without failing the cook.
#[test]
fn e57_setups_follow_their_stations() {
    let Some(p) = sample(FMB_E57) else { return };
    let (blob, stations, scan1) = {
        let e = E57::open(open_file(&p).unwrap()).unwrap();
        let st = e.stations();
        assert_eq!((e.scans.len(), st.len()), (2, 2));
        let face = st[1].cube.unwrap()[0];
        (
            e.images[face].image.unwrap().file_offset,
            st,
            e.scans[1].pose,
        )
    };
    // a blob section starts with id 0
    let mut e = head(E57::open(patched(&p, blob, &[0xFF])).unwrap());
    e.scans[0].pose = Pose::IDENTITY;
    let o = CookOptions::default();
    let (h, t, lines) = cooked(|sink, log| scan_cook::e57::cook(&e, sink, &o, log));
    assert_eq!(h.point_count, t.header.point_count);
    let setups = t.meta["setups"].as_array().unwrap();
    assert_eq!(setups.len(), 2);
    assert_pose(&setups[0]["pose"], &stations[0].pose.unwrap());
    assert_eq!(setups[0]["panorama"]["kind"], "cube");
    assert_pose(&setups[1]["pose"], &scan1);
    assert!(setups[1]["panorama"].is_null());
    assert!(lines.iter().any(|m| m.starts_with("warning: panorama of")));
    assert!(lines.last().unwrap().ends_with(", 1 panorama left out"));
}

/// Stations that are neither a cube nor a sphere (ordinary photos) become
/// setups where the photos were taken, not at the origin.
#[test]
fn e57_photo_stations_stand_where_taken() {
    let Some(p) = sample(FMB_E57) else { return };
    let mut e = head(E57::open(open_file(&p).unwrap()).unwrap());
    e.scans.truncate(1);
    for im in &mut e.images {
        im.projection = Projection::Visual;
    }
    let stations = e.stations();
    assert!(stations.iter().all(|s| s.pose.is_none()));
    // an E57 has no normals: asking for them adds neither flag nor stream
    let o = CookOptions {
        normals: true,
        ..Default::default()
    };
    let (h, t, _) = cooked(|sink, log| scan_cook::e57::cook(&e, sink, &o, log));
    assert_eq!(h.flags & FLAG_NORMALS, 0);
    assert!((0..t.nodes.len()).all(|i| t.decode(i).unwrap().normals.is_empty()));
    let setups = t.meta["setups"].as_array().unwrap();
    assert_eq!(setups.len(), stations.len());
    for (s, st) in setups.iter().zip(&stations) {
        assert_pose(
            &s["pose"],
            &Pose {
                translation: st.position,
                ..Pose::IDENTITY
            },
        );
        assert!(s["panorama"].is_null());
    }
}
