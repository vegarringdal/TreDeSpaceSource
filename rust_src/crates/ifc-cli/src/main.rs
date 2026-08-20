//! `ifc2glb` — command-line IFC → GLB converter.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use ifc_core::{ConvertOptions, Openings, OutputMode, Quality, Spaces, SplitTier, convert};

#[derive(Parser, Debug)]
#[command(
    name = "ifc2glb",
    about = "Convert IFC building models to GLB (binary glTF)."
)]
struct Args {
    /// IFC input file.
    #[arg(short, long)]
    input: PathBuf,

    /// Output folder (created if missing).
    #[arg(short, long, default_value = "./exports")]
    output: PathBuf,

    /// Output mode: `merged` (one mesh per colour + web3d extras), `standard` (one mesh per
    /// element, nested tree), `instanced` (shared meshes, node per occurrence), or
    /// `gpu-instanced` (shared meshes via EXT_mesh_gpu_instancing).
    #[arg(long, default_value = "merged")]
    mode: String,

    /// Split into separate GLB files by spatial tier: `none`, `site`, `building`, `storey`.
    #[arg(long, default_value = "none")]
    split: String,

    /// Tessellation detail: `lowest`, `low`, `medium`, `high`, `highest`.
    #[arg(long, default_value = "medium")]
    quality: String,

    /// IfcSpace handling: `skip`, `include` (with the model), or `separate` (own
    /// `*_spaces.glb`).
    #[arg(long, default_value = "skip")]
    spaces: String,

    /// IfcOpeningElement (void) handling: `skip`, `include` (fills the holes), or
    /// `separate` (own `*_openings.glb`).
    #[arg(long, default_value = "skip")]
    openings: String,

    /// Keep absolute IFC world coordinates instead of recentring on the bbox centre.
    #[arg(long)]
    no_recenter: bool,

    /// Parse + build geometry but write nothing.
    #[arg(short = 'x', long)]
    dry_run: bool,
}

fn main() -> ExitCode {
    let args = Args::parse();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &Args) -> Result<(), String> {
    let mode = OutputMode::parse(&args.mode).ok_or_else(|| format!("bad --mode: {}", args.mode))?;
    let split =
        SplitTier::parse(&args.split).ok_or_else(|| format!("bad --split: {}", args.split))?;
    let quality =
        Quality::parse(&args.quality).ok_or_else(|| format!("bad --quality: {}", args.quality))?;
    let spaces =
        Spaces::parse(&args.spaces).ok_or_else(|| format!("bad --spaces: {}", args.spaces))?;
    let openings = Openings::parse(&args.openings)
        .ok_or_else(|| format!("bad --openings: {}", args.openings))?;

    let bytes =
        std::fs::read(&args.input).map_err(|e| format!("reading {}: {e}", args.input.display()))?;

    let source_name = args
        .input
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "model.ifc".to_string());

    let opts = ConvertOptions {
        mode,
        split,
        quality,
        spaces,
        openings,
        recenter: !args.no_recenter,
        dry_run: args.dry_run,
        source_name,
    };

    let out = convert(&bytes, &opts)?;
    let r = &out.report;
    eprintln!(
        "parsed {}{}: {} meshes, {} triangles → {} file(s)",
        args.input.display(),
        r.schema
            .as_deref()
            .map(|s| format!(" [{s}]"))
            .unwrap_or_default(),
        r.mesh_count,
        r.triangle_count,
        r.file_count,
    );

    if args.dry_run {
        eprintln!("dry run: no files written");
        return Ok(());
    }

    std::fs::create_dir_all(&args.output)
        .map_err(|e| format!("creating {}: {e}", args.output.display()))?;
    for f in &out.files {
        let path = args.output.join(&f.name);
        std::fs::write(&path, &f.bytes).map_err(|e| format!("writing {}: {e}", path.display()))?;
        eprintln!("wrote {} ({} bytes)", path.display(), f.bytes.len());
    }
    Ok(())
}
