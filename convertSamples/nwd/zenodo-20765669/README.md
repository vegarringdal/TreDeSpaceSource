# Final-Project_main.nwf — a Navisworks NWF (federation file, no geometry)

- Source: Zenodo record https://doi.org/10.5281/zenodo.20765669 ("data of MRCPSP",
  2026-06-19), file `Final-Project_main.nwf` (fetched 2026-11-12). Only the NWF is kept here;
  the record also holds an 18 MB Revit file not needed for these tests.
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/
- Attribution: Mohammad Sajjad Moradnia, Yaghoub Alipouri, Saeed Assari, "data of MRCPSP",
  Zenodo, 2026, doi:10.5281/zenodo.20765669. Unmodified.
- Content: `lichunk-008`, `navisworks:448`; references `Str_Plans_951028.nwc` and
  `ARCH_ARC_F2_951128.nwc` (XRefTable) and carries TimeLiner data.

What it tests: an input with no geometry of its own — the converter must succeed with an
empty result and report the referenced models.
