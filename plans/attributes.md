# Attributes — importing the properties stored in model files (PLANNED, not scheduled)

> **Status: plan, started 2026-11-19.** Nothing here is built. It records
> what each importer does with object properties today and the decisions a
> strategy needs, so the work can start from facts. File and crate references
> were checked on 2026-11-19 — **check them again before starting**.
> "Attributes" is the name for the feature; the formats call them
> properties, property sets or attributes.

## Why

Most plant and building models carry per-object data next to the geometry:
tag numbers, line numbers, materials, specifications, quantities. Users
expect to click a part and see it, and to colour or select by it. Today the
viewer imports geometry and the object tree only (README › Supported files
says so for NWD / NWC), so that data is lost on import.

## Today

**Where attribute data comes from.** Only from SQLite databases the user
imports by hand in the SQL Assets panel (`sql_assets/<store>/<file>.db`).
They link to models by the item's tree path (`fullname`, lowercased and
trimmed — DESIGN.md › Packed SQL results). On top of that link:

- **SQL Detail** runs a report's detail query for the clicked item.
- **SQL Reports / SQL Table** colour, hide and select items from query
  results.
- **The host API's `sql.*` commands** do the same for a hosting page.

**What each importer does with the properties in its files:**

| Format | Properties in the file | Imported? |
|---|---|---|
| NWD / NWC | Per-node property sets: categories of named string / integer values | **No.** Decoded and validated in `rust_src/crates/nwd-core/src/properties.rs` (all 44 Huldra NWDs match their source attribute text exactly — `nwd-core/docs/what_we_know_v1.md` › Property stream). The command-line tool prints them (`nwd2glb --props`, JSON Lines). The in-app import reads only the file-comment block (date, user, banner) |
| RVM | None in the binary: names and hierarchy only. Attributes come as a separate text file exported next to the RVM | **No.** No reader for the attribute text file |
| IFC | Property sets and quantity sets (`IfcRelDefinesByProperties`), also inherited from the element's type | **No.** Nothing in `rust_src/crates/ifc-*` reads them |
| STEP | Product names; property definitions are possible but rare | **No** (names only) |
| GLB | Node `extras` (free-form, writer-specific) | **No** (names only) |
| E57 / LGSX | Scan and station metadata, not per object | Out of scope here |

## Proposal

Write imported attributes into **SQLite databases in the store**, keyed the
way the SQL panels already link data to models. Then SQL Detail, Reports,
the coloring and the host API work with imported attributes without
changes, and a hand-imported database and an imported model can be queried
together (`ATTACH`).

A sketch of the default, for the decisions below to confirm or change:

- **One database per model asset**: `sql_assets/<store>/<assetId>.attributes.db`.
  Removing or re-importing the model replaces one file; queries across
  models `ATTACH` the ones they need.
- **One long table for every format**:

  ```sql
  CREATE TABLE attributes (
    fullname TEXT NOT NULL,   -- the item's tree path, as the SQL panels link
    category TEXT NOT NULL,   -- property set / tab; '' when the format has none
    name     TEXT NOT NULL,
    value    TEXT,            -- numbers stay numbers (SQLite typing)
    PRIMARY KEY (fullname, category, name)
  ) WITHOUT ROWID;
  ```

  A long table takes any format's shape (IFC property sets, NWD categories,
  RVM element attributes) with no schema per file. Reports that want one
  column per attribute use a pivot view, which the importer can generate for
  the most common category.
- **Written at import**, by the converter worker that already holds the
  decoded file, in batched transactions. The import reports the row count in
  its result like it reports items.

## Decisions needed

1. **Storage:** SQLite in the store (proposed) vs a chunk inside the `.tdp`
   (needs its own viewer panel and query path) vs a JSON sidecar (no SQL).
2. **Schema:** the long table above (proposed) vs wide tables per category
   built at import.
3. **Key:** `fullname` as today (proposed). Before relying on it, measure
   whether tree paths are unique per model; if not, add the item's entry
   index as a second key and let the panels use it.
4. **On by default?** An Import Manager option per import, like the
   existing per-asset options. Attributes cost import time and OPFS quota
   (DESIGN.md › Browser storage: persistence and quota), so the option
   should show the size once a file has been imported.
5. **Lifecycle:** removing a model asset deletes its attribute database;
   re-import replaces it; the coarse variant shares the full one's (same
   item table).
6. **Separate attribute files:** formats whose attributes live outside the
   model (RVM) need an import path for a second file. Pair it with the model
   by base name in the Import Manager (proposed), or import it on its own
   onto an already loaded model.

## Per-format work

- **NWD / NWC — first.** The decode exists and is validated. Wire
  `properties.rs` into the wasm import, stream (fullname, category, name,
  value) rows to the SQL worker, write the database. Check the volume on the
  Huldra NWDs first (rows and bytes per model).
- **RVM — second.** Write a reader for the attribute text file and pair it
  with the RVM by base name. The Huldra open data ships these files; they
  are not in `convertSamples/rvm/` yet. Adding them gives a free cross-check:
  the NWD notes already show the NWD properties equal these files element
  for element, so both imports of one plant must produce the same rows.
- **IFC — third.** Read property and quantity sets, including type-level
  ones (an occurrence's own value wins). Check first what the ifc-lite
  kernel already exposes before writing our own scan.
- **STEP, GLB — on demand.** Only when a real file needs it; GLB `extras`
  have no standard shape.
- **A generic attribute import (CSV / JSON keyed by tree path)** would
  cover every format whose attributes come from a separate tool. It is the
  same database written from a different source; consider it after RVM.

## Later

- **Host API:** an `item.attributes` command (or attribute events on
  `tree.select`) for hosts that don't want to write SQL — add a sketch to
  `plans/future_events.md` when this starts.
- **Export:** IFC export could write attributes back as property sets; GLB
  export as node `extras`.
- **Search:** the hierarchy search could match attribute values, not only
  names.
