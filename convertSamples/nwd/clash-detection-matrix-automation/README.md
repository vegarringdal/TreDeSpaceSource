# Clash-Detection-Matrix-Automation — five Revit-loader NWCs + their NWF

- Source: https://github.com/Kennystruct/Clash-Detection-Matrix-Automation
  (folder `Navisworks Coordination Models/`, fetched 2026-11-12)
- Licence: BSD 2-Clause, Copyright (c) 2021, Kehinde Ayobade — see `LICENSE` in this folder.
  The repository's README describes these as the author's sample Revit models.
- Files: `Architectural.nwc`, `Structural.nwc`, `Mechanical.nwc`, `Plumbing.nwc`,
  `Electrical.nwc` (one building, five disciplines; `lichunk-008`, `navisworks:448`, Revit
  loader, geometry in FEET) and `Coordination.nwf` (references the five NWCs, clash tests).
  Unmodified.

What it tests: placement FRAMES of Revit exports — inline material-asset JSON records
(type 185) inside the id chain; transform slots that are inline, back-referenced or null;
and INSTANCED parts (a frame that references an earlier fragment: 4,487 of the structure's
4,706 placements) — plus the scene tree with instanced subtrees. No geometry ground truth
ships with it; the checks are structural: every declared frame is read, each lands on a tree
leaf, every tree leaf owns a frame, and the five disciplines share one building envelope.
