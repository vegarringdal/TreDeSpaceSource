# Changelog

Newest first. Each entry is dated and marked with the `package.json` version it
lands AFTER (`>0.0.68` = unreleased on top of 0.0.68); the director bumps the
version at release time. See CLAUDE.md for the rule.

- **2026.08.28** (>0.0.68):
  Docs: `docs/search-expressions.md` explains the Model Assets search — the
  `& | ( )` grammar, contains vs Equals (`*`) mode, that each term matches ANY
  of name / folder path / store, and how a matching asset implies its parent
  folders and store in the filtered tree.
- **2026.08.28** (>0.0.68):
  Hierarchy shows visibility: a row whose items are all hidden is dimmed with
  an eye-off badge, and a parent with SOME hidden items beneath it gets a
  dotted-eye badge — so hidden content is visible from any level, even
  collapsed. An opacity-0 override (Set Color's "hidden" quick toggle) counts
  as hidden too, since it is just as invisible. Folder rows and store bands
  carry the badge as well (summed over the model roots beneath them), so a
  fully collapsed tree still points at where the hidden content is. Costs
  nothing per row: the worker keeps per-entry subtree counts
  (items / hidden items), rebuilt lazily in one pass when a model's states
  change, and the tree reads them as O(1) lookups.
- **2026.08.28** (>0.0.68):
  Hierarchy: Ctrl+click can again deselect a row inside a Shift-selected
  range. The range had made the expanded PARENT a selection root, and the tree
  paints every row under an active root as selected — so the child's items
  were deselected but its row stayed highlighted. Deselecting under an active
  root now splits that root into its remaining sibling subtrees, and any
  range-selected rows BENEATH the deselected node stop being roots too (their
  items went with it) — so it works at every depth, not just the top level,
  and the tree stays in step with the actual selection.
- **2026.08.28** (>0.0.68):
  Model Assets tree: EVERYTHING starts collapsed — stores and every folder
  inside them, so expanding a store shows its folders still folded — and a
  search no longer force-expands the tree. The count each row already shows
  (files beneath it) is the match count while filtering, so a search reads as
  numbers on the collapsed rows.
- **2026.08.28** (>0.0.68):
  Measurements ribbon: new "Off when ribbon switch" toggle (default on,
  persisted; hotkey `measure.offOnSwitch`, ALT+1213). Leaving the ribbon —
  clicking another ribbon tab or activating a layout slot via the Layout
  ribbon / F-keys — puts the measurement tool back to Off, so a measuring
  mode never lingers while the user works elsewhere.
- **2026.08.28** (>0.0.68):
  The Clipping ribbon's Shapes button now opens the Clip Shapes panel (docked
  right, recreating the column if it was closed away). It was wired to a
  placeholder that only logged "shapes come later". The button gained a
  tooltip and a hotkey (`clipShapes.open`, ALT+1212).
- **2026.08.28** (>0.0.68):
  Model Assets and SQL Assets trees open fully collapsed — `main` included —
  and both panels gained Collapse all / Expand all buttons with hotkeys
  (`assets.collapseAll/expandAll` ALT+1210/1211, `sql.collapseAll/expandAll`
  ALT+1208/1209). The FileTree widget got `collapseAllSignal` /
  `expandAllSignal` props (edge-triggered counters the parent bumps; the tree
  keeps owning per-folder state) plus a `dirPaths()` helper; README and the
  widget gallery updated.
- **2026.08.28** (>0.0.68):
  Settings → Shortcuts: a search bar (matches label, description, id, category
  and the current key combo; groups with hits auto-expand). All `sql.*`
  shortcuts moved from `Home` into their own `SQL` category. The SQL kill
  shortcut is rebound from ALT+637 to `END`, now fires from inside the editor
  (`allowInInput`) and only while a query is running (`context`), so END keeps
  its end-of-line meaning when idle and an idle worker is never killed. Fixes
  the kill shortcut not working: focus is in the editor when you need it, and
  hotkeys are muted in inputs unless a binding opts in.
