# Changelog

Newest first. Each entry is dated and marked with the `package.json` version it
lands AFTER (`>0.0.68` = unreleased on top of 0.0.68); the director bumps the
version at release time. See CLAUDE.md for the rule.

- **2026.08.28** (>0.0.70):
  Hierarchy context menu: "Disable / Enable item edges on selected" — item-
  boundary edge lines off (or back on) per item, undoable like a hide, hotkeys
  ALT+802 / ALT+803. Only visible while Settings → Edges → item edges is on;
  where an edge-off item meets one with edges on, the silhouette still draws
  on the other item's side. Costs nothing: the flag rides the item state the
  scene shader already reads and a spare bit of the G-buffer edge tag.
  Fix: after a viewport pick, collapsing a folder in the Hierarchy did
  nothing — the reveal had opened it under two keys (store-qualified and
  plain) and the chevron only removed one.
  SQL coloring / selection results no longer exist as strings on the main
  thread: a COLORING run packs `fullname[, fullname_color]` in the SQL worker
  into flat buffers (one UTF-8 blob + offsets + per-row color/opacity,
  ~45 B/row), transfers them, and the model-db worker resolves them straight
  into per-model entry lists — a 4M-row result peaks around 200 MB instead of
  ~4 GB (each name used to be copied ~10 times: row arrays, clone, objects, a
  200 MB joined string, 4M-key Records, split/lowercase again). Same semantics
  as the Multi paste (deepest level wins, per-row color:opacity, yellow
  default); the coloring SELECT is DISTINCT. Selection from a result goes the
  same way (`selectPacked`, flat (model, entry) pairs). `sql.execute` /
  `sql.query` apply `maxRows` inside the worker (rows past the cap are never
  kept; `rowCount` still reports the true total), and uncollected statements
  no longer keep their rows at all.
  Stats overlay: the viewport overlay is now the SAME list as Settings → Stats
  (label/value lines, GPU pass times as a second block) instead of a terse
  summary line; each row in the Stats readout has a checkbox that leaves it out
  of the overlay (persisted). "Show overlay" also switches on GPU pass timing,
  and has a hotkey (ALT+1214). New `culled` row: % of meshlets culled this frame
  (drawn of total), in both places. The row set is fixed — a row that does not
  apply right now shows `—` instead of vanishing, so nothing shifts. A "Dimmed background" checkbox (default
  on, ALT+1215) paints a dark box behind the overlay so it reads over bright
  models.
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
