# Sample IFC files

Free/open sample IFC models used for testing ifc2glb. Not authored here.

## From buildingSMART `Sample-Test-Files` (public, official conformance samples)
Source: <https://github.com/buildingSMART/Sample-Test-Files> — IFC 4.0.2.1 set.

| File | Exercises |
|------|-----------|
| `tessellation-with-individual-colors.ifc` | per-face colours + `IfcTriangulatedFaceSet` |
| `column-straight-rectangle-tessellation.ifc` | simple tessellated element |
| `basin-tessellation.ifc` | curved tessellated geometry |
| `wall-with-opening-and-window.ifc` | opening (CSG void) + window in a wall |
| `Building-Architecture.ifc` | full multi-storey architectural model (spatial tree) |
| `Building-Structural.ifc` | structural model (beams/columns/slabs) |

## Larger models (stress / real buildings & infra)

| File | Size | What it is |
|------|------|-----------|
| `great-court-roof.ifc` | 3.6 MB | British Museum Great Court roof (geometrygym) — 5178 meshes / 166k triangles, a real stress model |
| `Infra-Bridge.ifc` | 1.9 MB | bridge infrastructure model (buildingSMART PCERT scene) |
| `Building-Landscaping.ifc` | 1.5 MB | site/landscaping model (PCERT scene) |
| `Infra-Road.ifc` | 432 KB | road alignment/infrastructure (PCERT scene) |

`great-court-roof.ifc` is from <https://github.com/IfcOpenShell/files>; the `Infra-*` /
`Building-Landscaping` files are from the buildingSMART PCERT sample scene.

### Really large models — `./fetch-large.sh` (not in git)

Too big to keep in git history, so they're downloaded on demand (and git-ignored). Run
`samples/fetch-large.sh` to pull them from the ThatOpen `engine_web-ifc` public corpus:

| File | Size | What it is |
|------|------|-----------|
| `dental_clinic.ifc` | ~13 MB | medical/dental clinic (IFC2X3) — 4111 meshes / 197k triangles; `--split storey` yields `First_Floor` / `Second_Floor` / `Roof_-_Main` / `TOF_Footing`. Converts in ~0.34 s (release). |
| `FM_ARC_DigitalHub.ifc` | ~14 MB | office / facility-management model |
| `C20-Institute-Var-2.ifc` | ~11 MB | institute building |

The script also lists (commented out) the ~34–56 MB `advanced_model`, `schependomlaan`
(the classic house), and an `ARK_NUS_skolebygg` school for heavier stress tests.

## From IfcOpenShell `files` (public test corpus)
Source: <https://github.com/IfcOpenShell/files>

| File | Exercises |
|------|-----------|
| `1019-column.ifc` | plain `IfcExtrudedAreaSolid` column (smallest end-to-end case) |

These give coverage of the geometry paths ifc-lite-geometry handles (extrusion, faceted
BRep, triangulated facesets, boolean clipping) plus a real spatial hierarchy and colours.
