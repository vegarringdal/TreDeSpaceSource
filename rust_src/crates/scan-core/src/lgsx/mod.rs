//! Leica LGSX reader (Cyclone REGISTER 360 / FIELD 360 / TruView / JetStream
//! "Leica Project File X"). Undocumented format — see `docs/LGSX_FORMAT.md`.
//!
//! Layers:
//! * [`container`] — the outer section index (`HXMETAV1`, EOF trailer).
//! * [`mpk`] — the myVR `mMapArchive` inside the `PointCloud` section.
//! * [`hspc`] / [`apr`] — the HSPC point octree (`hspcInfo.json`, `.apr`
//!   nodes with zstd byte planes).
//! * [`cube`] — per-setup cube-map panoramas.
//! * setups come from the embedded SQLite `ProjectDatabase`
//!   (`Hds_OdbSetup`).

pub mod apr;
pub mod container;
pub mod cube;
pub mod hspc;
pub mod mpk;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::model::{PointBatch, Pose};
use crate::source::Source;
use crate::sqlite;
use container::{Container, Section};
use hspc::{HspcInfo, NodeKey};
use mpk::Archive;

/// One octree node file.
#[derive(Clone, Debug)]
pub struct Node {
    pub key: NodeKey,
    /// Index into [`Archive::entries`].
    pub entry: usize,
}

/// Which cube-map product of a setup.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CubeKind {
    /// Colour panorama (JPEG).
    Camera,
    /// Scanner intensity (greyscale JPEG).
    ScanIntensity,
    /// Range image (JPEG XR).
    ScanDepth,
    /// Valid-range mask (PNG).
    DepthMask,
}

impl CubeKind {
    pub const ALL: [CubeKind; 4] = [
        CubeKind::Camera,
        CubeKind::ScanIntensity,
        CubeKind::ScanDepth,
        CubeKind::DepthMask,
    ];
    pub fn section_word(self) -> &'static str {
        match self {
            CubeKind::Camera => "camera",
            CubeKind::ScanIntensity => "scanintensity",
            CubeKind::ScanDepth => "scandepth",
            CubeKind::DepthMask => "depthmask",
        }
    }
}

/// A scanner setup (station) of the registration.
#[derive(Clone, Debug, Serialize)]
pub struct Setup {
    /// `Hds_OdbSetup.mId` — the `N` of the `SETUP-…-N` sections.
    pub db_id: i64,
    /// Value of the per-point `SetupIndexU8` attribute for this setup.
    pub point_index: Option<u8>,
    pub guid: String,
    pub name: String,
    pub label: String,
    /// GUID used for the setup's resources (and the E57 image names).
    pub resource_id: String,
    /// Setup (scanner) frame → project frame.
    pub pose: Pose,
    /// Sections holding this setup's cube maps.
    pub cubes: Vec<(CubeKind, usize)>,
}

/// A coordinate system of the project (`Hds_OdbCoordSystem`): the user
/// coordinate system the Leica software shows and exports coordinates in.
#[derive(Clone, Debug, Serialize)]
pub struct CoordSystem {
    pub db_id: i64,
    pub name: String,
    /// Coordinate-system frame → project frame; a project-frame point `p`
    /// has the coordinates `pose⁻¹(p)` in this system.
    pub pose: Pose,
    /// The workspace's active one — what an export (E57 …) is written in.
    pub active: bool,
    /// Created from applied survey control (`mIsControl`): the system that
    /// ties the project to real-world / site coordinates.
    pub control: bool,
}

pub struct Lgsx {
    pub container: Container,
    pub archive: Archive,
    pub info: HspcInfo,
    /// Every `.apr` node, coarse to fine.
    pub nodes: Vec<Node>,
    pub setups: Vec<Setup>,
    /// The project's coordinate systems; at most one is active.
    pub coord_systems: Vec<CoordSystem>,
    /// Every coordinate-related row of the project database, as text
    /// (see [`coordinate_report`]) — for diagnosing a scan that lands in
    /// the wrong place.
    pub coord_report: Vec<String>,
}

/// Database tables that can place the project in other coordinates. Only
/// `Hds_OdbCoordSystem` (with the workspace's active one) is applied; the
/// survey-control ones are empty or identity in every file seen so far, so
/// what they mean is not validated.
const COORD_TABLES: [&str; 8] = [
    "Hds_OdbWorkspace",
    "Hds_OdbSitemap",
    "Hds_OdbCoordSystem",
    "Hds_OdbControlCoordSystem",
    "Hds_OdbTerrestrial",
    "Hds_OdbSurveyControl",
    "Hds_OdbAppliedControl",
    "Hds_OdbControlPoint",
];
/// Rows listed per table before the report says "… more".
const REPORT_ROWS: usize = 12;

/// One line per row of the coordinate-related tables: the numbers and names
/// (ids, poses, offsets, WKT), without timestamps, GUIDs and blobs. Nothing
/// of the scan itself — safe to pass on when the file cannot be.
fn coordinate_report(db: &sqlite::Db) -> Vec<String> {
    let mut out = Vec::new();
    for name in COORD_TABLES {
        let Ok(t) = db.table(name) else {
            continue;
        };
        let short = name.trim_start_matches("Hds_Odb");
        if t.rows.is_empty() {
            out.push(format!("{short}: no rows"));
            continue;
        }
        for row in t.rows.iter().take(REPORT_ROWS) {
            let mut cells = Vec::new();
            for (col, v) in t.columns.iter().zip(row) {
                if col.contains("Time") || col.contains("Guid") || col.contains("Image") {
                    continue;
                }
                let key = col.trim_start_matches('m');
                match v {
                    sqlite::Value::Int(i) => cells.push(format!("{key}={i}")),
                    sqlite::Value::Real(r) => cells.push(format!("{key}={r}")),
                    sqlite::Value::Text(s) if !s.is_empty() => cells.push(format!("{key}=\"{s}\"")),
                    _ => {}
                }
            }
            out.push(format!("{short}: {}", cells.join(" ")));
        }
        if t.rows.len() > REPORT_ROWS {
            out.push(format!(
                "{short}: … {} more rows",
                t.rows.len() - REPORT_ROWS
            ));
        }
    }
    out
}

/// A row's pose: `mRotation0..3` = quaternion x, y, z, w, `mPosition0..2`.
fn row_pose(t: &sqlite::Table, row: &[sqlite::Value]) -> Pose {
    let num = |c: &str| t.get(row, c).as_f64();
    match (num("mRotation3"), num("mPosition0")) {
        (Some(w), Some(px)) => Pose {
            rotation: [
                w,
                num("mRotation0").unwrap_or(0.0),
                num("mRotation1").unwrap_or(0.0),
                num("mRotation2").unwrap_or(0.0),
            ],
            translation: [
                px,
                num("mPosition1").unwrap_or(0.0),
                num("mPosition2").unwrap_or(0.0),
            ],
        },
        _ => Pose::IDENTITY,
    }
}

/// The coordinate systems and which one the workspace has active
/// (`Hds_OdbWorkspace.mActiveCoordSystem`, 0 = none: the project frame).
/// Older files lack the tables — then there are none.
fn load_coord_systems(db: &sqlite::Db) -> Vec<CoordSystem> {
    let Ok(t) = db.table("Hds_OdbCoordSystem") else {
        return Vec::new();
    };
    let active = db
        .table("Hds_OdbWorkspace")
        .ok()
        .and_then(|w| {
            w.rows
                .first()
                .and_then(|r| w.get(r, "mActiveCoordSystem").as_i64())
        })
        .unwrap_or(0);
    t.rows
        .iter()
        .filter(|row| t.get(row, "mIsDeleted").as_i64() != Some(1))
        .map(|row| {
            let db_id = t.get(row, "mId").as_i64().unwrap_or(-1);
            CoordSystem {
                db_id,
                name: t.get(row, "mName").as_str().unwrap_or_default().to_string(),
                pose: row_pose(&t, row),
                active: active != 0 && db_id == active,
                control: t.get(row, "mIsControl").as_i64() == Some(1),
            }
        })
        .collect()
}

fn load_setups(
    container: &Container,
    info: &HspcInfo,
) -> Result<(Vec<Setup>, Vec<CoordSystem>, Vec<String>)> {
    let Some(sec) = container.section("ProjectDatabase") else {
        return Ok((Vec::new(), Vec::new(), Vec::new()));
    };
    let bytes = container.read(sec)?;
    // The points do not need the database: one that cannot be read, or that
    // lacks the setup table, leaves the scan without setups (and says so in
    // the report) instead of failing the open.
    let db = match sqlite::Db::open(&bytes) {
        Ok(db) => db,
        Err(e) => {
            let note = format!("ProjectDatabase: {e} — setups not read");
            return Ok((Vec::new(), Vec::new(), vec![note]));
        }
    };
    let coord_systems = load_coord_systems(&db);
    let mut coord_report = coordinate_report(&db);
    let t = match db.table("Hds_OdbSetup") {
        Ok(t) => t,
        Err(e) => {
            coord_report.push(format!("Setup: {e} — setups not read"));
            return Ok((Vec::new(), coord_systems, coord_report));
        }
    };
    let mut out = Vec::new();
    for row in &t.rows {
        if t.get(row, "mIsDeleted").as_i64() == Some(1) {
            continue;
        }
        let text = |c: &str| t.get(row, c).as_str().unwrap_or_default().to_string();
        let db_id = t.get(row, "mId").as_i64().unwrap_or(-1);
        let name = text("mName");
        let pose = row_pose(&t, row);
        let cubes = CubeKind::ALL
            .iter()
            .filter_map(|&k| {
                let sn = format!("SETUP-{}-{db_id}", k.section_word());
                container
                    .sections
                    .iter()
                    .position(|s| s.name == sn)
                    .map(|i| (k, i))
            })
            .collect();
        out.push(Setup {
            db_id,
            point_index: info
                .setup_lut
                .iter()
                .find(|(_, n)| *n == name)
                .map(|&(i, _)| i as u8),
            guid: text("mGuid"),
            label: text("mLabel"),
            resource_id: text("mResourceId"),
            name,
            pose,
            cubes,
        });
    }
    out.sort_by_key(|s| (s.point_index.map_or(u16::MAX, |i| i as u16), s.db_id));
    Ok((out, coord_systems, coord_report))
}

impl Lgsx {
    /// The coordinate system the project is meant to be read in: the
    /// workspace's active one, else the one made from applied survey control
    /// (a project can have control applied without that system being the
    /// active one — the control is still what ties it to the site), else
    /// none: the project frame.
    pub fn coord_system(&self) -> Option<&CoordSystem> {
        self.coord_systems
            .iter()
            .find(|c| c.active)
            .or_else(|| self.coord_systems.iter().find(|c| c.control))
    }

    /// Project frame → the coordinates of [`Lgsx::coord_system`] (identity
    /// without one).
    pub fn world_pose(&self) -> Pose {
        self.coord_system()
            .map_or(Pose::IDENTITY, |c| c.pose.inverse())
    }

    pub fn open(src: Source) -> Result<Lgsx> {
        let container = Container::open(src)?;
        let pc = container
            .section("PointCloud")
            .ok_or_else(|| Error::Format("LGSX has no PointCloud section".into()))?
            .clone();
        let archive = Archive::open(container.open_section(&pc)?)?;
        let info_entry = archive
            .find("/hspcInfo.json")
            .ok_or_else(|| Error::Format("PointCloud archive has no hspcInfo.json".into()))?;
        let info = HspcInfo::parse(&archive.read(info_entry)?)?;
        let mut nodes: Vec<Node> = archive
            .entries
            .iter()
            .enumerate()
            .filter_map(|(i, e)| {
                Some(Node {
                    key: NodeKey::from_path(&e.path)?,
                    entry: i,
                })
            })
            .collect();
        nodes.sort_by(|a, b| b.key.level.cmp(&a.key.level).then(a.key.cmp(&b.key)));
        let (setups, coord_systems, coord_report) = load_setups(&container, &info)?;
        Ok(Lgsx {
            container,
            archive,
            info,
            nodes,
            setups,
            coord_systems,
            coord_report,
        })
    }

    pub fn node_bytes(&self, node: &Node) -> Result<Vec<u8>> {
        self.archive.read(&self.archive.entries[node.entry])
    }

    /// Decode one node (Morton order, grid coordinates).
    pub fn read_node(&self, node: &Node) -> Result<apr::NodePoints> {
        let (h, pts) = apr::decode(&self.node_bytes(node)?)?;
        if [h.key[0] as u32, h.key[1] as u32, h.key[2] as u32]
            != [node.key.x, node.key.y, node.key.z]
            || h.level != node.key.level
        {
            return Err(Error::Format(format!(
                "APRN header key differs from its file name {:?}",
                node.key
            )));
        }
        Ok(pts)
    }

    /// Decode one node into project-frame points.
    pub fn node_batch(&self, node: &Node) -> Result<PointBatch> {
        let p = self.read_node(node)?;
        Ok(PointBatch {
            positions: p.grid.iter().map(|&g| self.info.to_world(g)).collect(),
            colors: p.rgb,
            intensity: p
                .intensity
                .map(|v| v.into_iter().map(|x| x as f32 / 65535.0).collect()),
            setup: p.setup.map(|v| v.into_iter().map(u16::from).collect()),
        })
    }

    /// The section of a setup's cube map.
    pub fn cube_section(&self, setup: &Setup, kind: CubeKind) -> Option<&Section> {
        setup
            .cubes
            .iter()
            .find(|(k, _)| *k == kind)
            .map(|&(_, i)| &self.container.sections[i])
    }

    /// Parse a cube section's face table. Image spans are relative to the
    /// section; read them with [`Lgsx::read_image`].
    pub fn cube(&self, sec: &Section) -> Result<cube::Cube> {
        let b = self.container.read(sec)?;
        cube::parse(&b)
    }

    pub fn read_image(&self, sec: &Section, img: &cube::ImageSpan) -> Result<Vec<u8>> {
        self.container
            .source()
            .read_vec(sec.offset + img.offset, img.len as usize)
    }
}
