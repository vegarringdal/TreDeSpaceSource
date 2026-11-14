//! `scan` — inspect, export and cook LGSX / E57 laser-scan files.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand, ValueEnum};
use scan_core::e57::E57;
use scan_core::lgsx::{CubeKind, Lgsx};
use scan_core::source::{open_file, Source};
use scan_core::PointBatch;
use serde_json::json;

#[derive(Parser)]
#[command(
    name = "scan",
    version,
    about = "Inspect, export and cook LGSX / E57 laser-scan files (→ .tdpp)"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Clone, Copy, ValueEnum)]
enum Kind {
    Camera,
    Intensity,
    Depth,
    Mask,
}

#[derive(Subcommand)]
enum Cmd {
    /// Summary (JSON): scans/setups, poses, point counts, images
    Info { input: PathBuf },
    /// LGSX: list the container sections and the point archive files
    Sections {
        input: PathBuf,
        /// also list every file of the PointCloud archive
        #[arg(long)]
        files: bool,
    },
    /// E57: print the XML section
    Xml { input: PathBuf },
    /// Export points to binary PLY (x y z double, rgb, intensity, setup)
    Points {
        input: PathBuf,
        #[arg(short, long)]
        output: PathBuf,
        /// stop after this many points
        #[arg(long)]
        max_points: Option<u64>,
        /// keep every N-th point
        #[arg(long, default_value_t = 1)]
        stride: usize,
        /// LGSX: only nodes at or above this octree level (coarse LOD)
        #[arg(long)]
        min_level: Option<u32>,
        /// E57: transform points by the scan pose into the file's world frame
        #[arg(long)]
        apply_pose: bool,
    },
    /// Export panorama images and a manifest.json with poses
    Pano {
        input: PathBuf,
        #[arg(short, long)]
        output: PathBuf,
        /// LGSX cube product
        #[arg(long, value_enum, default_value_t = Kind::Camera)]
        kind: Kind,
        /// LGSX mip level (0 = full resolution)
        #[arg(long, default_value_t = 0)]
        level: usize,
        /// only this setup / scan index
        #[arg(long)]
        setup: Option<usize>,
    },
    /// Cook into .tdpp (streamable cluster-quantized point octree + panoramas)
    Cook {
        input: PathBuf,
        #[arg(short, long)]
        output: PathBuf,
        /// points per cluster (meshopt_spatialClusterPoints)
        #[arg(long, default_value_t = 256)]
        cluster_size: usize,
        /// meshopt vertex codec level 0..3
        #[arg(long, default_value_t = 2)]
        codec_level: i32,
        /// E57: max points per octree node
        #[arg(long, default_value_t = 65_536)]
        node_capacity: usize,
        /// E57: max points of a subtree built in memory
        #[arg(long, default_value_t = 8_000_000)]
        chunk_points: usize,
        /// E57: max points held per pass over the input (memory bound)
        #[arg(long, default_value_t = 48_000_000)]
        batch_points: usize,
        /// E57: grid resolution in metres
        #[arg(long, default_value_t = 0.001)]
        e57_resolution: f64,
        /// skip panorama levels larger than this (px); 0 = no panoramas
        #[arg(long, default_value_t = 4096)]
        pano_max_size: u32,
        /// LGSX: also write the per-point normal stream (larger file)
        #[arg(long)]
        normals: bool,
        /// keep 16-bit intensity (default: 8 bits, about a byte per point less)
        #[arg(long)]
        intensity16: bool,
        /// LGSX: keep the project's internal frame (default: its coordinate system)
        #[arg(long)]
        project_frame: bool,
        #[arg(long)]
        threads: Option<usize>,
    },
    /// Summary of a .tdpp (header, nodes per depth, setups)
    TdppInfo { input: PathBuf },
    /// Verify a .tdpp against the LGSX / E57 it was cooked from
    Verify {
        tdpp: PathBuf,
        source: PathBuf,
        #[arg(long)]
        threads: Option<usize>,
    },
}

fn main() {
    let cli = Cli::parse();
    if let Err(e) = run(cli) {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

type Res<T> = Result<T, Box<dyn std::error::Error>>;

enum Input {
    E57(Box<E57>),
    Lgsx(Box<Lgsx>),
}

fn open(path: &Path) -> Res<Input> {
    let src: Source = open_file(path)?;
    let mut head = [0u8; 16];
    src.read_at(0, &mut head)?;
    if &head[..8] == b"ASTM-E57" {
        Ok(Input::E57(Box::new(E57::open(src)?)))
    } else if &head == b"wild::geosystems" {
        Ok(Input::Lgsx(Box::new(Lgsx::open(src)?)))
    } else {
        Err(format!("{}: neither an E57 nor an LGSX file", path.display()).into())
    }
}

fn run(cli: Cli) -> Res<()> {
    match cli.cmd {
        Cmd::Info { input } => info(&input),
        Cmd::Sections { input, files } => sections(&input, files),
        Cmd::Xml { input } => match open(&input)? {
            Input::E57(e) => {
                print!("{}", e.xml_text()?);
                Ok(())
            }
            Input::Lgsx(_) => Err("xml: not an E57 file".into()),
        },
        Cmd::Points {
            input,
            output,
            max_points,
            stride,
            min_level,
            apply_pose,
        } => points(
            &input,
            &output,
            max_points.unwrap_or(u64::MAX),
            stride.max(1),
            min_level,
            apply_pose,
        ),
        Cmd::Pano {
            input,
            output,
            kind,
            level,
            setup,
        } => pano(&input, &output, kind, level, setup),
        Cmd::Cook {
            input,
            output,
            cluster_size,
            codec_level,
            node_capacity,
            chunk_points,
            batch_points,
            e57_resolution,
            pano_max_size,
            normals,
            intensity16,
            project_frame,
            threads,
        } => {
            let mut o = scan_cook::CookOptions {
                cluster_size,
                codec_level,
                node_capacity,
                chunk_points,
                batch_points,
                e57_resolution,
                pano_max_size,
                normals,
                intensity16,
                project_frame,
                ..Default::default()
            };
            if let Some(t) = threads {
                o.threads = t;
            }
            cook(&input, &output, &o)
        }
        Cmd::TdppInfo { input } => tdpp_info(&input),
        Cmd::Verify {
            tdpp,
            source,
            threads,
        } => verify(&tdpp, &source, threads),
    }
}

fn info(input: &Path) -> Res<()> {
    let v = match open(input)? {
        Input::E57(e) => json!({
            "format": "e57",
            "header": e.header,
            "guid": e.guid,
            "library": e.library_version,
            "points": e.total_points(),
            "scans": e.scans,
            "stations": e.stations(),
            "images": e.images,
        }),
        Input::Lgsx(l) => {
            let mut levels = std::collections::BTreeMap::<u32, usize>::new();
            for n in &l.nodes {
                *levels.entry(n.key.level).or_default() += 1;
            }
            json!({
                "format": "lgsx",
                "writer": l.container.writer_version,
                "sections": l.container.sections.len(),
                "point_cloud": l.info,
                "octree_nodes": l.nodes.len(),
                "nodes_per_level": levels.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<_, _>>(),
                "cube_faces": scan_core::model::CUBE_FACES,
                "setups": l.setups,
                "coordinate_systems": l.coord_systems,
                "coordinate_report": l.coord_report,
            })
        }
    };
    println!("{}", serde_json::to_string_pretty(&v)?);
    Ok(())
}

fn sections(input: &Path, files: bool) -> Res<()> {
    let Input::Lgsx(l) = open(input)? else {
        return Err("sections: not an LGSX file".into());
    };
    for s in &l.container.sections {
        println!(
            "{:4} kind={} off={:12} size={:11} {}",
            s.id, s.kind, s.offset, s.size, s.name
        );
    }
    if files {
        for (i, e) in l.archive.entries.iter().enumerate() {
            println!(
                "file {i:5} off={:12} size={:9} {}",
                e.offset, e.size, e.path
            );
        }
    }
    Ok(())
}

/// Binary little-endian PLY writer; the vertex count is patched at the end.
struct Ply {
    w: BufWriter<File>,
    count_pos: u64,
    n: u64,
}

const COUNT_WIDTH: usize = 20;

impl Ply {
    fn create(path: &Path, comment: &str) -> Res<Ply> {
        let mut w = BufWriter::with_capacity(1 << 22, File::create(path)?);
        write!(
            w,
            "ply\nformat binary_little_endian 1.0\ncomment {comment}\nelement vertex "
        )?;
        w.flush()?;
        let count_pos = w.get_mut().stream_position()?;
        write!(
            w,
            "{:<COUNT_WIDTH$}\nproperty double x\nproperty double y\nproperty double z\n\
             property uchar red\nproperty uchar green\nproperty uchar blue\n\
             property float intensity\nproperty ushort setup\nend_header\n",
            0
        )?;
        Ok(Ply { w, count_pos, n: 0 })
    }
    fn push(&mut self, b: &PointBatch, stride: usize, budget: &mut u64) -> Res<()> {
        let mut i = 0;
        while i < b.len() && *budget > 0 {
            let p = b.positions[i];
            for v in p {
                self.w.write_all(&v.to_le_bytes())?;
            }
            let c = b.colors.as_ref().map_or([255, 255, 255], |c| c[i]);
            self.w.write_all(&c)?;
            let it = b.intensity.as_ref().map_or(0.0, |v| v[i]);
            self.w.write_all(&it.to_le_bytes())?;
            let s = b.setup.as_ref().map_or(0, |v| v[i]);
            self.w.write_all(&s.to_le_bytes())?;
            self.n += 1;
            *budget -= 1;
            i += stride;
        }
        Ok(())
    }
    fn finish(mut self) -> Res<u64> {
        self.w.flush()?;
        let f = self.w.get_mut();
        f.seek(SeekFrom::Start(self.count_pos))?;
        write!(f, "{:<COUNT_WIDTH$}", self.n)?;
        Ok(self.n)
    }
}

fn points(
    input: &Path,
    output: &Path,
    max: u64,
    stride: usize,
    min_level: Option<u32>,
    apply_pose: bool,
) -> Res<()> {
    let t = std::time::Instant::now();
    let mut budget = max;
    let n = match open(input)? {
        Input::E57(e) => {
            let mut ply = Ply::create(output, "scan export from E57")?;
            for s in 0..e.scans.len() {
                let mut r = e.points(s, apply_pose)?;
                while budget > 0 {
                    let Some(b) = r.next_batch()? else { break };
                    ply.push(&b, stride, &mut budget)?;
                }
            }
            ply.finish()?
        }
        Input::Lgsx(l) => {
            let mut ply = Ply::create(output, "scan export from LGSX (project frame)")?;
            for node in l
                .nodes
                .iter()
                .filter(|n| min_level.is_none_or(|m| n.key.level >= m))
            {
                if budget == 0 {
                    break;
                }
                let b = l.node_batch(node)?;
                ply.push(&b, stride, &mut budget)?;
            }
            ply.finish()?
        }
    };
    eprintln!(
        "wrote {n} points to {} in {:.1}s",
        output.display(),
        t.elapsed().as_secs_f64()
    );
    Ok(())
}

fn pano(input: &Path, out: &Path, kind: Kind, level: usize, only: Option<usize>) -> Res<()> {
    std::fs::create_dir_all(out)?;
    let mut manifest = Vec::new();
    match open(input)? {
        Input::E57(e) => {
            // cube stations in the shared face layout; any other image as-is
            let stations = e.stations();
            let mut in_cube = vec![false; e.images.len()];
            for (si, st) in stations.iter().enumerate() {
                let Some(cube) = st.cube else { continue };
                cube.iter().for_each(|&i| in_cube[i] = true);
                if only.is_some() && only != Some(si) {
                    continue;
                }
                let mut faces = Vec::new();
                for (fi, &ii) in cube.iter().enumerate() {
                    let Some(blob) = e.images[ii].image else {
                        continue;
                    };
                    let name = format!("station{si:03}_face{fi}.{}", blob.format.extension());
                    std::fs::write(out.join(&name), e.read_blob(&blob)?)?;
                    faces.push(json!({ "face": fi, "file": name, "image": ii,
                                       "width": e.images[ii].width, "height": e.images[ii].height }));
                }
                manifest.push(json!({ "station": si, "pose": st.pose, "name": e.images[cube[0]].name, "faces": faces }));
            }
            for img in e.images.iter().filter(|i| !in_cube[i.index]) {
                if only.is_some() {
                    continue;
                }
                let Some(blob) = img.image else { continue };
                let scan = e
                    .scans
                    .iter()
                    .position(|s| Some(&s.guid) == img.scan_guid.as_ref());
                let name = format!("image{:04}.{}", img.index, blob.format.extension());
                std::fs::write(out.join(&name), e.read_blob(&blob)?)?;
                manifest.push(json!({ "file": name, "scan": scan, "image": img }));
            }
        }
        Input::Lgsx(l) => {
            let ck = match kind {
                Kind::Camera => CubeKind::Camera,
                Kind::Intensity => CubeKind::ScanIntensity,
                Kind::Depth => CubeKind::ScanDepth,
                Kind::Mask => CubeKind::DepthMask,
            };
            for (si, s) in l.setups.iter().enumerate() {
                if only.is_some() && only != Some(si) {
                    continue;
                }
                let Some(sec) = l.cube_section(s, ck) else {
                    continue;
                };
                let cube = l.cube(sec)?;
                let mut faces = Vec::new();
                for (fi, chain) in cube.faces.iter().enumerate() {
                    let Some(img) = chain.get(level).or(chain.last()) else {
                        continue;
                    };
                    let name = format!(
                        "setup{si:03}_{}_face{fi}.{}",
                        ck.section_word(),
                        img.format.extension()
                    );
                    std::fs::write(out.join(&name), l.read_image(sec, img)?)?;
                    faces.push(
                        json!({ "face": fi, "file": name, "width": img.width, "height": img.height,
                                       "levels": chain.len() }),
                    );
                }
                manifest.push(json!({ "setup": s, "section": sec.name, "faces": faces }));
            }
        }
    }
    let m = out.join("manifest.json");
    std::fs::write(&m, serde_json::to_string_pretty(&manifest)?)?;
    eprintln!("wrote {} entries + {}", manifest.len(), m.display());
    Ok(())
}

fn cook(input: &Path, output: &Path, o: &scan_cook::CookOptions) -> Res<()> {
    let log = |m: &str| eprintln!("cook: {m}");
    let h = match open(input)? {
        Input::Lgsx(l) => scan_cook::lgsx::cook(
            &l,
            Box::new(scan_cook::writer::FileSink::create(output)?),
            o,
            &log,
        ),
        Input::E57(e) => scan_cook::e57::cook(
            &e,
            Box::new(scan_cook::writer::FileSink::create(output)?),
            o,
            &log,
        ),
    }
    .map_err(|e| e.to_string())?;
    eprintln!(
        "wrote {}: {} points, {} nodes, {:.2} GB ({:.2} B/point incl. panoramas)",
        output.display(),
        h.point_count,
        h.node_count,
        h.file_size as f64 / 1e9,
        h.file_size as f64 / h.point_count.max(1) as f64
    );
    Ok(())
}

fn tdpp_info(input: &Path) -> Res<()> {
    let t = scan_cook::reader::Tdpp::open(open_file(input)?).map_err(|e| e.to_string())?;
    let mut per_depth = std::collections::BTreeMap::<u8, (u64, u64, u64, u64)>::new();
    for r in &t.nodes {
        let e = per_depth.entry(r.depth).or_default();
        e.0 += 1;
        e.1 += r.point_count as u64;
        e.2 += r.cluster_count as u64;
        e.3 += r.payload_size as u64;
    }
    let h = &t.header;
    let v = json!({
        "file_size": h.file_size,
        "point_count": h.point_count,
        "node_count": h.node_count,
        "cluster_size": h.cluster_size,
        "origin": h.origin,
        "bounds": { "min": h.bounds_min, "max": h.bounds_max },
        "flags": h.flags,
        "setup_count": h.setup_count,
        "depths": per_depth.iter().map(|(d, (n, p, c, b))| json!({
            "depth": d, "nodes": n, "points": p, "clusters": c,
            "payload_bytes": b, "bytes_per_point": *b as f64 / (*p).max(1) as f64,
        })).collect::<Vec<_>>(),
        "source": t.meta["source"],
        "frame": t.meta["frame"],
        "setups": t.meta["setups"].as_array().map(|a| a.len()),
    });
    println!("{}", serde_json::to_string_pretty(&v)?);
    Ok(())
}

fn verify(tdpp: &Path, source: &Path, threads: Option<usize>) -> Res<()> {
    let threads = threads.unwrap_or_else(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
    });
    let t = scan_cook::reader::Tdpp::open(open_file(tdpp)?).map_err(|e| e.to_string())?;
    let t0 = std::time::Instant::now();
    let r = match open(source)? {
        Input::Lgsx(l) => scan_cook::verify::against_lgsx(&t, &l, threads),
        Input::E57(e) => scan_cook::verify::against_e57(&t, &e, threads),
    }
    .map_err(|e| e.to_string())?;
    println!("{}", serde_json::to_string_pretty(&r)?);
    eprintln!(
        "verify: {} in {:.0}s",
        if r.ok { "OK" } else { "FAILED" },
        t0.elapsed().as_secs_f64()
    );
    if !r.ok {
        return Err("verification failed".into());
    }
    Ok(())
}
