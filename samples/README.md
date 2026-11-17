# samples — demo assets

The model the live demo page (`docs/demo.html`) loads, and its licence. They live here rather
than in `public/` so Vite's public copy never touches them; `vite.config.ts` (`sampleAssets`)
ships the GLB gzipped and the PDF as it is.

## `HuldraDemo.glb` — Equinor open-data plant model

- Source: Equinor ASA open data, "Huldra Plant 3D models"
  (https://www.equinor.com/energy/data-sharing — the data is provided through Equinor's
  Databricks Marketplace listing,
  https://marketplace.databricks.com/provider/006d1a44-e5d8-4d20-8bd7-e9a311106007/Equinor-ASA).
  Huldra was a wellhead platform on the Norwegian continental shelf, in production from 2001.
- Licence: Equinor's terms and conditions for the Huldra data, in this folder as
  [`EquinorDemoLicense.pdf`](EquinorDemoLicense.pdf). It is based on CC BY 4.0, with two
  changes: the material may not be sold, and the licence covers all data in the dataset
  whether or not it is protected by copyright. Sharing is permitted with attribution to
  Equinor ASA and a notice referring to the terms (§4.3).
- Attribution: Huldra 3D model data © Equinor ASA, shared under the terms above. Equinor
  acknowledges Rosenberg Verft (today Aker Solutions) for the construction of Huldra; the
  model was matured in detail engineering by Aker Kværner.
- Not endorsed: this project is not connected with, sponsored or endorsed by Equinor ASA (§5).
- Modified: this is the structural model of area HE (`/HE-STRU`, 9,741 objects), converted
  from the dataset's AVEVA E3D RVM export to GLB with this project's RVM converter. The
  conversion turns the geometry into triangles and merges it into one mesh; the object
  hierarchy and names are kept.
