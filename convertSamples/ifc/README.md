# Sample IFC files

Free/open sample IFC models used for testing the IFC converter. Not authored here, and
not kept in git: they are third-party files, so `./fetch-samples.sh` downloads them from
their public sources (each pinned to a commit, so the bytes stay fixed) into this folder,
where they are git-ignored.

```sh
./fetch-samples.sh           # the small samples below — needed by the ifc-core / ifc-wasm tests
                             # and the a01 guide scene (docs:shots)
./fetch-samples.sh --large   # …plus the really large models
```

## From buildingSMART `Sample-Test-Files` (official conformance samples)
Source: <https://github.com/buildingSMART/Sample-Test-Files> — IFC 4.0.2.1 set.

| File | Exercises |
|------|-----------|
| `tessellation-with-individual-colors.ifc` | per-face colours + `IfcTriangulatedFaceSet` |
| `column-straight-rectangle-tessellation.ifc` | simple tessellated element |
| `basin-tessellation.ifc` | curved tessellated geometry |
| `wall-with-opening-and-window.ifc` | opening (CSG void) + window in a wall |

The PCERT sample scene, from the same repository:

| File | Size | What it is |
|------|------|-----------|
| `Building-Architecture.ifc` | 224 KB | full multi-storey architectural model (spatial tree) |
| `Building-Structural.ifc` | 292 KB | structural model (beams/columns/slabs) |
| `Infra-Bridge.ifc` | 1.9 MB | bridge infrastructure model |
| `Building-Landscaping.ifc` | 1.5 MB | site/landscaping model |
| `Infra-Road.ifc` | 432 KB | road alignment/infrastructure |

## From IfcOpenShell `files` (public test corpus)
Source: <https://github.com/IfcOpenShell/files>

| File | What it is |
|------|-----------|
| `1019-column.ifc` | plain `IfcExtrudedAreaSolid` column (smallest end-to-end case) |
| `great-court-roof.ifc` | British Museum Great Court roof (geometrygym, 3.6 MB) — 5178 meshes / 166k triangles, a real stress model |

## Really large models — `--large`
From the ThatOpen `engine_web-ifc` public corpus:

| File | Size | What it is |
|------|------|-----------|
| `dental_clinic.ifc` | ~13 MB | medical/dental clinic (IFC2X3) — 4111 meshes / 197k triangles; `--split storey` yields `First_Floor` / `Second_Floor` / `Roof_-_Main` / `TOF_Footing`. Converts in ~0.34 s (release). |
| `FM_ARC_DigitalHub.ifc` | ~14 MB | office / facility-management model |
| `C20-Institute-Var-2.ifc` | ~11 MB | institute building |

The script also lists (commented out) the ~34–56 MB `advanced_model`, `schependomlaan`
(the classic house), and an `ARK_NUS_skolebygg` school for heavier stress tests.

These give coverage of the geometry paths ifc-lite-geometry handles (extrusion, faceted
BRep, triangulated facesets, boolean clipping) plus a real spatial hierarchy and colours.
