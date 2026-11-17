# Huldra — Equinor open-data plant model (RVM)

Ten RVM files from the Huldra plant model, the test inputs of the RVM converter.

- Source: Equinor ASA open data, "Huldra Plant 3D models"
  (https://www.equinor.com/energy/data-sharing — the data is provided through Equinor's
  Databricks Marketplace listing,
  https://marketplace.databricks.com/provider/006d1a44-e5d8-4d20-8bd7-e9a311106007/Equinor-ASA).
  Huldra was a wellhead platform on the Norwegian continental shelf, in production from 2001.
- Licence: Equinor's terms and conditions for the Huldra data, in this folder as
  [`Equinor open data sharing license - Huldra RVM files.pdf`](Equinor%20open%20data%20sharing%20license%20-%20Huldra%20RVM%20files.pdf).
  It is based on CC BY 4.0, with two changes: the material may not be sold, and the licence
  covers all data in the dataset whether or not it is protected by copyright. Sharing is
  permitted with attribution to Equinor ASA and a notice referring to the terms (§4.3).
- Attribution: Huldra 3D model data © Equinor ASA, shared under the terms above. Equinor
  acknowledges Rosenberg Verft (today Aker Solutions) for the construction of Huldra; the
  model was matured in detail engineering by Aker Kværner.
- Not endorsed: this project is not connected with, sponsored or endorsed by Equinor ASA (§5).
- Files (unmodified, as in the dataset): the AVEVA E3D RVM exports of area HA, one per
  discipline — `HA-ARCH`, `HA-ELEC`, `HA-HVAC`, `HA-INST`, `HA-MECH`, `HA-PIPE`, `HA-PSUP`,
  `HA-SAFE`, `HA-STRU` and `HA-TELE` (`.RVM`).

What uses them: the RVM converter's tests (`rust_src/crates/rvm-wasm/tests/direct_cook.rs`,
`rust_src/crates/cooker-core/tests/golden.rs`), the wasm smoke test (`tests/wasmSmoke.test.ts`)
and the user guide's screenshots (`scripts/doc-shots.mjs`). The rest of the dataset is not
committed; [`../nwd/huldra/README.md`](../nwd/huldra/README.md) says where to get it.
