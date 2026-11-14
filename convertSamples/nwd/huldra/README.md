# Huldra — Equinor open-data plant model (RVM loader)

Three NWDs from the Huldra plant model, the main reference for the RVM-loader pipeline.

- Source: Equinor ASA open data, "Huldra Plant 3D models"
  (https://www.equinor.com/energy/data-sharing — the data is provided through Equinor's
  Databricks Marketplace listing,
  https://marketplace.databricks.com/provider/006d1a44-e5d8-4d20-8bd7-e9a311106007/Equinor-ASA).
  Huldra was a wellhead platform on the Norwegian continental shelf, in production from 2001.
- Licence: Equinor's terms and conditions for the Huldra data, in this folder as
  [`Equinor open data sharing license - Huldra.pdf`](Equinor%20open%20data%20sharing%20license%20-%20Huldra.pdf).
  It is based on CC BY 4.0, with two changes: the material may not be sold, and the licence
  covers all data in the dataset whether or not it is protected by copyright. Sharing is
  permitted with attribution to Equinor ASA and a notice referring to the terms (§4.3).
- Attribution: Huldra 3D model data © Equinor ASA, shared under the terms above. Equinor
  acknowledges Rosenberg Verft (today Aker Solutions) for the construction of Huldra; the
  model was matured in detail engineering by Aker Kværner.
- Not endorsed: this project is not connected with, sponsored or endorsed by Equinor ASA (§5).
- Files (unmodified, as in the dataset):
  - `HDA-ASB-CD2.nwd` — a small single-root area NWD (852 fragments);
  - `HDA-ASB-HA.nwd` — a multi-file area NWD (ten RVM File roots; property blocks spanning
    four chunks);
  - `Huldra_Asbuilt.nwd` — the assembly NWD of all 22 areas (35 MB, 426,528 fragments).

What it tests: container, chunk-8 object map, scene tree, property stream and end-to-end
conversion on RVM-loader files. The expected values were validated against the full
dataset's two independent references — Navisworks' own FBX export (geometry and tree) and the
source AVEVA attribute `.txt` files (properties); results are in
`rust_src/crates/nwd-core/docs/what_we_know_v1.md` under *Live metrics*.

## The full dataset (not committed)

The dataset also holds the other 20 area NWDs, the same 22 + assembly "with insulation and
obstruction", the 69 AVEVA E3D RVM exports with their 69 attribute `.txt` listings (the
source), and 69 FBX files exported by Navisworks. That is ~600 MB zipped, so it stays out of
git; download it from the source above (one zip per dataset folder — `nwd.zip`, `rvm.zip`,
`fbx.zip`, `nwd_assembly.zip` and their `*_insulation_and_obstruction.zip` twins). The
scripts that ran the full validation against it are not part of this repository; any of its
NWDs converts with the CLI:

```sh
cd rust_src && cargo run --release -p nwd-cli -- <file>.nwd -o <output dir>
```
