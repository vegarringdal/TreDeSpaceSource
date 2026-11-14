# scan-* — laser scans (Leica LGSX, ASTM E57) → `.tdpp`

| crate | what |
|---|---|
| `scan-core` | readers: LGSX (HSPC point octree in the myVR mMapArchive, setups from the embedded SQLite project DB, CUBE panoramas, normal codec) and E57 (paged CRC layer, XML, CompressedVector bitpack incl. parallel record-range decoding, images grouped into cube stations). Everything reads through `ReadAt` — files are many GB and are never loaded whole; pure Rust, wasm-safe. |
| `scan-cook` | `.tdpp` writer/reader/verify; LGSX cook (octree re-encoded 1:1) and out-of-core E57 octree build (`meshopt_simplifyPoints` subsamples). Node payloads are `meshopt_spatialClusterPoints` clusters with integer-step u16 quantization and vertex-codec streams. Byte-deterministic. |
| `scan-cli` | `scan` binary: `info`, `sections`, `xml`, `points` (PLY), `pano`, `cook`, `tdpp-info`, `verify`. |
| `scan-wasm` | `info(io)` / `cook(io, optionsJson)` for a Web Worker (`io`: `size`, `read(offset, len)`, `write(offset, bytes)`, `progress`). |

Specs: [`docs/LGSX_FORMAT.md`](docs/LGSX_FORMAT.md) (reverse-engineered,
every claim validated against the E57 export of the same project) and
[`../scan-cook/docs/TDPP_FORMAT.md`](../scan-cook/docs/TDPP_FORMAT.md). The
viewer-side reader is `src/lib/tdpp/tdppFormat.ts`.

```sh
cargo run --release -p scan-cli -- cook scan.lgsx -o scan.tdpp [--normals]
cargo run --release -p scan-cli -- verify scan.tdpp scan.lgsx
```

Sample-file tests (`scan-core/tests/samples.rs`) read `<repo>/scanSamples/`
(gitignored; override with `SCAN_SAMPLES`) and skip when files are absent.
Validation tools are under `scan-core/examples` (`lgsx_vs_e57`, `lgsx_full`,
`e57_par`, `lgsx_normals`) and `scan-cook/examples` (`tdpp_synth` — the
viewer test fixture — `tdpp_dump`, `tdpp_render`).
