# params_test_desks — small Revit-loader NWD

- Source: https://github.com/JoaoMartins-callmeJohn/forge-nodes-properties
  (`samples/params_test_desks.nwd`, fetched 2026-11-12; the same folder holds the Revit
  source `params_test_desks.rvt`, not needed by the tests and not copied here)
- Licence: MIT, Copyright (c) 2022 JoaoMartins-Forge — see `LICENSE` in this folder.
- Content: six instances of the `M_Desk : 1525 x 762mm` family in a 3 × 2 grid (Portuguese
  Revit), exported to Navisworks (`lichunk-008`, Revit loader, `navisworks:448`). Geometry is
  stored in FEET. Unmodified.

What it tests: a non-RVM (Revit) loader with INSTANCING — the desk's three solids are
defined once; the other five desks are placement frames that reference those fragments and
tree nodes that reference the first desk's subtree. Expected conversion: 18 meshes (6 × 3),
34 tree nodes, one `Level_1.glb`; one desk is 1563 × 762 × 819 mm (the 1525 × 762 mm
footprint + top overhang, 762 mm high), the grid spans 10.9 × 3.65 m.
