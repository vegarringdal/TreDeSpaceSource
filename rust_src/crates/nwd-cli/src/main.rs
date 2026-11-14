//! nwd — convert Autodesk Navisworks NWD files to GLB or cooked `.tdp`.
//!
//! Modes: default converts to GLB (placement-preview: one box per fragment at
//! its decoded world transform). `--inspect` reports the container chunks,
//! `--names` prints the logical-hierarchy node names, `--dump` writes each
//! inflated chunk. Per-fragment triangle geometry lands once the geometry
//! stream's bit-packed connectivity is decoded (see
//! `nwd-core/docs/what_we_know_v1.md`).

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

#[derive(Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum ModeArg {
    Merged,
    Standard,
}

#[derive(Parser)]
#[command(
    name = "nwd",
    about = "Convert Navisworks NWD files to GLB or cooked .tdp"
)]
struct Cli {
    /// Input .nwd / .nwc file.
    input: PathBuf,

    /// Output .glb path (default: <input>.glb).
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Report the container chunks and exit (Phase 1 recon).
    #[arg(long)]
    inspect: bool,

    /// Dump every inflated chunk to <dir>/chunk_NN_0xOFFSET.bin and exit.
    #[arg(long)]
    dump: Option<PathBuf>,

    /// Print the logical-hierarchy node names and exit (Phase 2).
    #[arg(long)]
    names: bool,

    /// Decode the scene-graph nodes (id, parent, depth, kind, class, child
    /// count, diffuse colour, name) and print a TAB-separated table, then exit.
    /// Redirect to a `.txt`; columns align on tab stops. NWD-native.
    #[arg(long)]
    tree: bool,

    /// Like `--tree`, but emit a GitHub-flavoured **Markdown table** (redirect to
    /// a `.md`). Same columns; the name column is indented by depth.
    #[arg(long = "tree-md")]
    tree_md: bool,

    /// Print every node's PROPERTIES (the Navisworks property tabs — for
    /// RVM-loader files the PDMS attributes) as JSON Lines, one object per
    /// node that carries a property set: {"id","name","category","props"}.
    #[arg(long)]
    props: bool,

    /// Cook every root straight to `.tdp` (the viewer's format) instead of
    /// writing its GLB; the merged GLB only exists in memory.
    #[arg(long)]
    tdp: bool,

    /// With `--tdp`: also write `<root>.coarse.tdp` (VRAM-budget variant).
    #[arg(long)]
    coarse: bool,

    /// Include Line primitives (construction/datum layer), rendered as "+"
    /// crosses. Off by default (rvm2glb parity).
    #[arg(long = "include-line")]
    include_line: bool,

    /// Width (output units = metres, see `--units`) of the line "+" crosses.
    #[arg(long = "line-width", default_value_t = 0.005)]
    line_width: f32,

    /// Unit of the stored geometry, scaled to metres in the output: `auto`
    /// (feet for a Revit-loader file, otherwise as stored), `asis` (no
    /// scaling), `ft`, `in`, `mm`, `cm`, `m`, or a number (the factor model
    /// units → metres, e.g. `0.3048`).
    #[arg(long, default_value = "auto", value_parser = parse_units)]
    units: nwd_core::convert::UnitScale,

    /// Emit per-vertex smooth NORMAL accessors. Off by default — viewers
    /// regenerate flat normals from positions.
    #[arg(long = "include-normals")]
    include_normals: bool,

    /// Remove duplicate vertex positions per item (vertex weld).
    #[arg(short = 'd', long = "cleanup-position", default_value_t = 1)]
    cleanup_position: u8,

    /// Rounding precision (decimal places) used when deduplicating positions.
    /// Triangles whose corners round to the same point are dropped, so a low
    /// value removes small geometry (3 = 1 mm grid; applied after `--units`).
    #[arg(short = 'p', long = "cleanup-precision", default_value_t = 3)]
    cleanup_precision: u8,

    /// meshopt simplification threshold (fraction of indices to keep;
    /// 1.0 = off). Only active when built with the `optimize` feature.
    #[arg(short = 'm', long = "meshopt-threshold", default_value_t = 0.75)]
    meshopt_threshold: f32,

    /// meshopt target error. Only active with the `optimize` feature.
    #[arg(short = 'e', long = "meshopt-target-error", default_value_t = 0.0)]
    meshopt_target_error: f32,

    /// Debug view: colour every placed primitive distinctly (so a leaf's
    /// multiple primitives — a weld's disc + cylinders, a datum's lines — are
    /// visually separable), instead of the semantic per-leaf colours.
    #[arg(long)]
    part_colors: bool,

    /// Per-root GLB structure. `merged` (default): one mesh per colour with
    /// `draw_ranges_nodeK` + `id_hierarchy` scene extras (`web3dversion: 2`).
    /// `standard`: plain glTF — one mesh per part under the decoded node tree.
    /// Either way the output is one GLB per root site plus `status_file.json`;
    /// `-o` names the output DIRECTORY (default: `<input stem>_merged/`).
    #[arg(long, value_enum, default_value_t = ModeArg::Merged)]
    mode: ModeArg,
}

/// `--units`: a named unit, `auto` / `asis`, or a positive factor.
fn parse_units(s: &str) -> Result<nwd_core::convert::UnitScale, String> {
    use nwd_core::convert::{UnitScale, FEET_TO_METRES};
    Ok(UnitScale::Factor(match s.to_ascii_lowercase().as_str() {
        "auto" => return Ok(UnitScale::Auto),
        "asis" | "m" => 1.0,
        "ft" => FEET_TO_METRES,
        "in" => 0.0254,
        "mm" => 0.001,
        "cm" => 0.01,
        other => match other.parse::<f32>() {
            Ok(f) if f.is_finite() && f > 0.0 => f,
            _ => {
                return Err(
                    "expected auto, asis, ft, in, mm, cm, m or a positive factor (model units → metres)"
                        .into(),
                )
            }
        },
    }))
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let opts = nwd_core::convert::ConvertOptions {
        mode: match cli.mode {
            ModeArg::Merged => nwd_core::convert::OutputMode::Merged,
            ModeArg::Standard => nwd_core::convert::OutputMode::Standard,
        },
        include_line: cli.include_line,
        line_width: cli.line_width,
        include_normals: cli.include_normals,
        cleanup_position: cli.cleanup_position != 0,
        cleanup_precision: cli.cleanup_precision,
        meshopt_threshold: cli.meshopt_threshold,
        meshopt_target_error: cli.meshopt_target_error,
        part_colors: cli.part_colors,
        unit_scale: cli.units,
    };
    let bytes = match std::fs::read(&cli.input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("failed to read {}: {e}", cli.input.display());
            return ExitCode::FAILURE;
        }
    };

    let container = match nwd_core::parse(&bytes) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("parse error: {e}");
            return ExitCode::FAILURE;
        }
    };

    // Diagnostics go to stderr so stdout stays clean for piped data (--names).
    eprintln!("signature : {}", container.signature);
    eprintln!(
        "header    : {} bytes before first chunk",
        container.header_blob.len()
    );
    eprintln!("chunks    : {}", container.chunks.len());

    if let Some(dir) = &cli.dump {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("failed to create {}: {e}", dir.display());
            return ExitCode::FAILURE;
        }
        for (i, ch) in container.chunks.iter().enumerate() {
            let path = dir.join(format!("chunk_{i:02}_0x{:08x}.bin", ch.offset));
            if let Err(e) = std::fs::write(&path, container.data(i)) {
                eprintln!("failed to write {}: {e}", path.display());
            }
        }
        println!(
            "dumped {} chunk(s) to {}/",
            container.chunks.len(),
            dir.display()
        );
        return ExitCode::SUCCESS;
    }

    if cli.names {
        let infos = nwd_core::inspect::classify_all(&container);
        let mut printed = false;
        for info in &infos {
            if info.kind == nwd_core::inspect::ChunkKind::LogicalHierarchy {
                let chunk = &container.data(info.index);
                match nwd_core::hierarchy::node_names(chunk) {
                    Ok(names) => {
                        println!(
                            "# chunk {} (0x{:x}): {} node names",
                            info.index,
                            info.offset,
                            names.len()
                        );
                        for n in &names {
                            println!("{n}");
                        }
                        printed = true;
                    }
                    Err(e) => eprintln!("hierarchy parse error: {e}"),
                }
            }
        }
        if !printed {
            eprintln!("no logical-hierarchy chunk found");
            return ExitCode::FAILURE;
        }
        return ExitCode::SUCCESS;
    }

    if cli.tree || cli.tree_md {
        let md = cli.tree_md;
        let infos = nwd_core::inspect::classify_all(&container);
        for info in &infos {
            if info.kind == nwd_core::inspect::ChunkKind::LogicalHierarchy {
                let nodes = nwd_core::hierarchy::parse_nodes(&container.data(info.index));
                let geom = nodes.iter().filter(|n| n.geometry).count();
                // Columns: id, parent, depth, kind, class, children, color, name.
                // `class` (interned scene-graph class) and `children` (child count)
                // are parsed but were absent from the old dump.
                let cols = [
                    "id", "parent", "depth", "kind", "class", "children", "material", "color",
                    "name",
                ];
                if md {
                    println!(
                        "# {} nodes — {} geometry leaves, {} containers\n",
                        nodes.len(),
                        geom,
                        nodes.len() - geom
                    );
                    println!("| {} |", cols.join(" | "));
                    // right-align numeric columns
                    println!("|---:|---:|---:|:--|:--|---:|---:|:--|:--|");
                } else {
                    println!(
                        "# {} nodes\t{} geometry leaves\t{} containers",
                        nodes.len(),
                        geom,
                        nodes.len() - geom
                    );
                    println!("{}", cols.join("\t"));
                }
                for n in &nodes {
                    let color = n
                        .color
                        .map(|c| {
                            format!(
                                "#{:02x}{:02x}{:02x}",
                                (c[0] * 255.0) as u8,
                                (c[1] * 255.0) as u8,
                                (c[2] * 255.0) as u8
                            )
                        })
                        .unwrap_or_else(|| "-".into());
                    let kind = if n.geometry { "geometry" } else { "container" };
                    let par = n
                        .parent_id
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| "-".into());
                    let class: String = n.class.as_deref().unwrap_or("-").to_string();
                    let children = if n.geometry {
                        "-".into()
                    } else {
                        n.child_count.to_string()
                    };
                    let material = n
                        .material_id
                        .map(|m| m.to_string())
                        .unwrap_or_else(|| "-".into());
                    let d = n.depth as usize;
                    if md {
                        let indent = "&nbsp;".repeat(d * 2);
                        let name = format!("{indent}{}", n.display).replace('|', "\\|");
                        let class = class.replace('|', "\\|");
                        println!(
                            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |",
                            n.id, par, n.depth, kind, class, children, material, color, name
                        );
                    } else {
                        let name = format!("{}{}", "  ".repeat(d), n.display);
                        println!(
                            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                            n.id, par, n.depth, kind, class, children, material, color, name
                        );
                    }
                }
                return ExitCode::SUCCESS;
            }
        }
        eprintln!("no logical-hierarchy chunk found");
        return ExitCode::FAILURE;
    }

    if cli.props {
        use nwd_core::{hierarchy, inspect, properties};
        let infos = inspect::classify_all(&container);
        let Some(hi) = infos
            .iter()
            .find(|i| i.kind == inspect::ChunkKind::LogicalHierarchy)
        else {
            eprintln!("no logical-hierarchy chunk found");
            return ExitCode::FAILURE;
        };
        let hdata = container.data(hi.index);
        let nodes = hierarchy::parse_nodes(&hdata);
        let table = hierarchy::header_table(&hdata);
        drop(hdata);
        let chunks = properties::find_chunks(&container, hi.index, table.len());
        if chunks.len() != table.len() {
            eprintln!(
                "property chunks: found {} of {} (header table)",
                chunks.len(),
                table.len()
            );
        }
        // Ownership: a node with F attribute slots owns the next F − 1 blocks
        // (slot 0 is the material), in DFS order. One JSON line per node with
        // a non-empty set: its first non-empty set gives category + props;
        // further non-empty sets (none seen yet) go to "more".
        let mut owners = nodes.iter().filter(|n| n.property_sets() > 0);
        let mut cur: Option<(&hierarchy::Node, u32, Vec<properties::PropBlock>)> = None;
        let mut reader = properties::PropReader::new();
        let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
        let (mut total, mut unowned) = (0usize, 0usize);
        let to_json = |blk: &properties::PropBlock| {
            let mut props = serde_json::Map::new();
            for (k, v) in &blk.props {
                let jv = match v {
                    properties::PropValue::Str(s) => serde_json::Value::from(s.as_str()),
                    properties::PropValue::Int(i) => serde_json::Value::from(*i),
                };
                props.insert(k.clone(), jv);
            }
            serde_json::Value::Object(props)
        };
        let mut emit = |node: &hierarchy::Node, sets: Vec<properties::PropBlock>| {
            use std::io::Write;
            let mut it = sets.into_iter().filter(|b| !b.props.is_empty());
            let Some(first) = it.next() else { return };
            let mut line = serde_json::json!({
                "id": node.id,
                "name": node.display,
                "category": first.category,
                "props": to_json(&first),
            });
            let more: Vec<serde_json::Value> = it
                .map(|b| serde_json::json!({"category": b.category, "props": to_json(&b)}))
                .collect();
            if !more.is_empty() {
                line["more"] = serde_json::Value::from(more);
            }
            let _ = writeln!(stdout, "{line}");
        };
        for (k, &ci) in chunks.iter().enumerate() {
            let data = container.data(ci);
            let res = reader.feed(&data, |blk| {
                total += 1;
                if cur.is_none() {
                    cur = owners.next().map(|n| (n, n.property_sets(), Vec::new()));
                }
                match cur.as_mut() {
                    Some((_, left, sets)) => {
                        sets.push(blk);
                        *left -= 1;
                    }
                    None => unowned += 1,
                }
                if matches!(cur, Some((_, 0, _))) {
                    let (n, _, sets) = cur.take().unwrap();
                    emit(n, sets);
                }
            });
            match res {
                Ok(n) if table.get(k).is_some_and(|&t| t as usize != n) => eprintln!(
                    "property chunk {ci}: {n} blocks, header table says {}",
                    table[k]
                ),
                Ok(_) => {}
                Err((n, off)) => {
                    eprintln!("property chunk {ci}: grammar stopped after {n} blocks at byte {off}")
                }
            }
        }
        let owners_left = owners.count() + usize::from(cur.is_some());
        eprintln!(
            "properties: {total} blocks over {} chunk(s); {} owning nodes left without blocks, {unowned} blocks without a node",
            chunks.len(),
            owners_left
        );
        return ExitCode::SUCCESS;
    }

    if cli.inspect {
        let infos = nwd_core::inspect::classify_all(&container);
        println!();
        println!(
            "{:>3}  {:>8}  {:>10}  {:>10}  {:<18}  preview",
            "#", "offset", "comp", "inflated", "kind"
        );
        println!("{}", "-".repeat(96));
        for info in &infos {
            let preview = info
                .strings
                .iter()
                .find(|s| s.len() >= 4)
                .cloned()
                .unwrap_or_default();
            let preview: String = preview.chars().take(40).collect();
            println!(
                "{:>3}  {:>8}  {:>10}  {:>10}  {:<18?}  {}",
                info.index,
                format!("0x{:x}", info.offset),
                info.compressed_len,
                info.inflated_len,
                info.kind,
                preview,
            );
        }
        return ExitCode::SUCCESS;
    }

    // Convert (always per-root: mode merged|standard) — purely from parsing
    // the NWD, streaming each output file straight to disk.
    let dir = cli.output.clone().unwrap_or_else(|| {
        PathBuf::from(format!(
            "{}_{}",
            cli.input.file_stem().unwrap_or_default().to_string_lossy(),
            if cli.tdp { "tdp" } else { "merged" }
        ))
    });
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("failed to create {}: {e}", dir.display());
        return ExitCode::FAILURE;
    }
    let source_name = cli
        .input
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut write_err: Option<String> = None;
    let (tdp, coarse, normals) = (cli.tdp, cli.coarse, cli.include_normals);
    let mut sink = |name: &str, data: &[u8]| -> nwd_core::Result<()> {
        let mut outs: Vec<(String, Vec<u8>)> = Vec::new();
        match name.strip_suffix(".glb").filter(|_| tdp) {
            Some(stem) => {
                let (full, c) = cook_glb(data, normals, coarse).map_err(|e| {
                    write_err = Some(format!("cooking {name} failed: {e}"));
                    nwd_core::Error::Decode(e)
                })?;
                outs.push((format!("{stem}.tdp"), full));
                if let Some(c) = c {
                    outs.push((format!("{stem}.coarse.tdp"), c));
                }
            }
            None => outs.push((name.to_string(), data.to_vec())),
        }
        for (file, bytes) in outs {
            let path = dir.join(&file);
            std::fs::write(&path, &bytes).map_err(|e| {
                write_err = Some(format!("failed to write {}: {e}", path.display()));
                nwd_core::Error::Io(e)
            })?;
            println!("wrote {} ({} bytes)", path.display(), bytes.len());
        }
        Ok(())
    };
    match nwd_core::convert::convert_stream(&bytes, &opts, &source_name, &mut sink) {
        Ok(report) => {
            println!(
                "geometries: {}  fragments: {}  meshes: {}  linked: {}  lines: {}  triangles: {}",
                report.geometries,
                report.fragments,
                report.placed,
                report.linked,
                report.lines,
                report.triangles
            );
            if report.unit_scale != 1.0 {
                println!("units: geometry scaled × {}", report.unit_scale);
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            match write_err {
                Some(w) => eprintln!("{w}"),
                None => eprintln!("conversion error: {e}"),
            }
            ExitCode::FAILURE
        }
    }
}

/// GLB → cooked `.tdp` (+ coarse variant), with the RVM converter's cook
/// options (`rvm-wasm::cook_merged`).
fn cook_glb(
    glb: &[u8],
    compute_normals: bool,
    coarsen: bool,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let opts = cooker_core::CookOptions {
        compute_normals,
        dense_bounds: true,
        coarsen: None,
        spatial_order: true,
    };
    if !coarsen {
        return cooker_core::cook(glb, opts)
            .map(|o| (o.bytes, None))
            .map_err(|e| e.to_string());
    }
    let (full, coarse) = cooker_core::cook_both(glb, opts).map_err(|e| e.to_string())?;
    Ok((full.bytes, Some(coarse.bytes)))
}
