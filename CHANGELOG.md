# Changelog

Newest first. Each entry is dated and marked with the `package.json` version it
lands AFTER (`>0.0.68` = unreleased on top of 0.0.68); the director bumps the
version at release time. See CLAUDE.md for the rule.

- **2026.09.03** (>0.0.83):
  External apps get a per-app iframe policy. Every panel and modal iframe
  kept one hard-coded `sandbox="allow-scripts allow-same-origin allow-forms
  allow-downloads"` and no `allow` attribute; that stays the base, and two
  OPTIONAL lists on the entry widen it — `sandbox` (popups, which also let the
  popup escape the sandbox; modals; pointer-lock; storage-access, so the page
  may ask the browser for its own unpartitioned cookies/storage through the
  Storage Access API) and `allow` (camera, microphone, geolocation,
  fullscreen, clipboard-read/write, autoplay, display-capture,
  publickey-credentials-get, identity-credentials-get, web-share,
  picture-in-picture, payment). Both are empty unless set, so every existing
  entry, saved or host-set, renders with exactly the attributes it always
  had; top navigation is never offered. Settings → External shows them as two
  checkbox rows per app; `externalApps.set` accepts them (unknown values are
  `bad-payload`) and `externalApps.list` returns them. Cross-frame DOM and
  storage access was never the sandbox's to grant — the same-origin policy
  isolates any page on another origin — but a page on the VIEWER's own origin
  gets everything, so the editor now warns on such an entry and
  `externalApps.set` returns a `warning` for it (the bundled demo is exempt).
  All in `src/state/externalAppPolicy.ts`; EVENTS.md → "Iframe policy".
  `plans/VRAM_V2.md` — approved plan for VRAM residency v2, not started
  (another fix comes first). It records what the "97 % idle" convergence
  measurement hides — every swap resets TAA/AO accumulation, so a 176-swap
  run renders ~1000 full-scene frames for a camera that never moved — and
  lays out three phases: batched and quiet swap commits, a zero-seeded
  visibility buffer, trigger-based visibility refresh and four fixes; a
  target-set planner so each zone swaps at most once per rest, with
  priority by projected coverage; and a suggested-budget hint from adapter
  info, plus an opt-in "pause AO / TAA while optimizing" setting so a burst
  renders single-sample frames and converges once at the end. Decisions
  locked with the director: one re-convergence per batch by default, total
  tracked VRAM stays the ceiling, `maxInFlight` 2 / 4 / 6.
- **2026.09.03** (>0.0.82):
  SQL Detail now runs like a host listening to `tree.select`: every tree
  select — tree row, viewport pick, U / P, digit+click, a repeat click on the
  node already selected — runs the bound query the moment the click resolves,
  from the same tree-view path the host event carries. It used to watch the
  selection store for a CHANGE of active node, which arrived only after the
  selection's bookkeeping round-trips, and never re-ran for the same node.
  API selections (`selection.set`, `sql.select`) still reach it through the
  store; a click that the store then settles on is not run twice. Only the
  latest run may fill the form — two quick clicks could complete out of order
  and leave the first click's row on screen. No rows now names the node
  ("No data found for …"). The in-app fan-out is `onTreeSelect` in
  `lib/treeSelectEvent.ts`, next to the host emit; the old viewport-pick
  fan-out nobody subscribed to is gone (only the last pick is still recorded,
  for TREE_VIEW_ARGS with nothing selected). Listening / Paused moved into
  the panel binding so it survives a layout swap, and the header button's
  `sql.detail.listen` hotkey (Alt&651) — declared but never bound — now
  pauses or resumes every detail panel at once.
  SQL Detail fields can carry several source rows and links. A column whose
  value is a JSON ARRAY — `json_group_array(json_object('label', …, 'value',
  …, 'value_link_label', …))` in the query — flattens into one field per
  element in place of the column: `label` is the field name (repeats are
  fine, rows are keyed by index), `value` the value, and a value that is an
  http(s) URL renders as a link opening in a new tab, with
  `value_link_label` as its text when given (the URL otherwise). Plain
  columns holding an http(s) URL become links too, labelled "Open link", the
  URL in the tooltip. Only http and https link. Anything that is not a
  well-formed JSON array is shown as before, so existing reports keep their
  shape; the filter box also matches link text and the source column name.
  The rules live in `detailFields.ts` (unit-tested), documented under
  `sql.detail` in EVENTS.md and in the report editor's SQL hint.
- **2026.09.01** (>0.0.80):
  Host API: colouring and selecting from SQL now take the SAME packed path the
  SQL editor's buttons use, so a big result never crosses the postMessage
  boundary. New `sql.color` (white / hidden / set — the three colour buttons),
  `sql.select`, `sql.table` and `sql.detail`: the host sends the QUERY, the
  viewer runs it, packs the fullnames inside the SQL worker (~45 B/row,
  DISTINCT, column-probed) and transfers them to the model DB — the response
  is a row count. Going through `sql.query` + a colour rule instead
  materialises every row as JSON twice, which is what these commands exist to
  avoid. All four take `filters` (FILTER_ARGS rows, so one query can be
  parameterised per call), `attach`, and `progress: true` to run without
  viewer dialogs and stream row ticks instead.
  For lists the host itself computed there is now a binary channel:
  `selection.setList` and `colorRules.applyList` take the fullnames as UTF-8
  bytes (one `fullname[<TAB>color[:opacity]]` per line — the Multi paste
  grammar) through the message's `bytes` side-channel, packed viewer-side with
  no JS string per row (`packedFromBytes`); the SDK gained `encodeNameList()` /
  `decodeNameList()` to build and read them. Packed selection also learned
  `append`, matching `selection.set`.
  Colour modes are now a tagged union instead of a loose string, shared by
  `sql.color` and `colorRules.applyList`: `default-white` / `default-hidden` /
  `default-transparent` (white base at 0.1, or your own opacity) /
  `default-set`, plus `custom-color` (your highlight colour over a base of
  `white` / `transparent` / `hidden` / `none`) and `custom-set` (your OWN Set
  Color config runs first — for a config the host stores — then the hits on
  top). Every colouring consumer, buttons included, now goes through one
  `colorPackedMode` resolver. New `colors.names` returns the ~147 colour names
  the viewer accepts anywhere a colour token is read, so a host can validate
  or offer them. In the app: a **Color Transparent** button next to Color
  White in the SQL editor, the report test row and the coloring apply box
  (Alt&1220) — the same 10% white base, so the model stays readable behind the
  highlight.
  `sql.detail` can now create its OWN panel: `name` is the identity and the tab
  title, so several queries follow the selection side by side, and calling
  again with a name already in use re-binds that panel instead of opening
  another (no name = the built-in SQL Detail panel). The panels are registered
  on demand and are session-only, the same contract host-managed external apps
  have; the response carries the dock panel id for `ui.showPanel` /
  `ui.hidePanel`. One `SqlDetail` component now serves every detail panel,
  keyed by its panel id. Closing a named panel removes it completely by
  default (`autoRemove`, and an **Auto-remove / Keep** button in the panel
  header lets the user override the host's choice); with Keep on, the panel
  stays in the Panels list with its query. A layout change is not a close.
  @treDeSpaceUI: the dock gained `PanelDefinition.onClose` (a REAL close only —
  a layout swap disposes content without firing it, so it is the hook a
  runtime panel can safely clean up from) and `manager.unregisterPanel(id)`,
  which closes the panel silently and forgets its definition, location and
  title.
  `stores.list` counted 3D models only, which made a store holding just SQL
  databases look empty: it now reports `modelCount` and `sqlCount` with
  `count` as their total, and re-scans the SQL index first (the filesystem IS
  that index, so a database imported elsewhere was invisible until then).
  `stores.create` returns the same shape.
  New `sql.editor` (SDK `sqlEditor`): hand SQL to the SQL Editor PANEL for the
  user to read and run, instead of running it headless. `replace` (default
  true) swaps the script; `replace: false` appends it as a titled block
  (`-- name` between two rules, name defaulting to `sql`) so a host can stack
  queries; the text selection is cleared either way, or the panel's buttons
  would run a slice of the old script. `store` + `fileName` point the Main db
  at a database without the host building OPFS paths (`mainDb` still takes a
  path, `''` = None), and `show: false` fills the panel without opening it.
- **2026.09.01** (>0.0.79):
  Host API grew four things hosts kept asking for. `selection.set` takes
  `append: true` — build a selection up over several calls instead of
  replacing it. `nav.flyTo` / `nav.orbit` take `wait: true` — the response
  comes back only once the camera has ARRIVED, so a chained screenshot no
  longer catches the glide mid-flight. New `nav.fitVisible` frames everything
  that is not hidden (hide/isolate first, then fit) — also an in-app button in
  the pad ribbon's View group and the hierarchy toolbar, on Alt&1219. New
  `model.reset` resets the model's overrides by kind — `color`, `opacity`,
  `hidden`, `transform`, any subset; an empty payload resets all four. Colour,
  opacity and hidden still clear as ONE undo step (the existing "Clear all"
  now runs through the same bit-masked path).
  @treDeSpaceUI: `InlinePanel` no longer forces UPPERCASE headers —
  `titleUppercase={false}` keeps the title as written and `titleClassName`
  restyles the header text (a node as `title` still takes over completely).
  Dock: a tab strip whose tabs wrap onto extra rows kept only ONE row's worth
  of height between them — every row was squeezed to its line box, so a
  two-row strip looked half as tall per row as a one-row one. Rows now sit at
  the top at the full `headerHeight` each, stacked flush (the row gap is gone)
  with a 1px rule under each row, so stacked rows read as rows instead of one
  run-on line of labels — a single-row strip is untouched. The strip's
  MEASURED height (ResizeObserver per strip) is also folded into the group's
  minimum size, so the extra rows can no longer squeeze a panel body below its
  own minimum.
- **2026.08.30** (>0.0.78):
  API `colorRules.apply` (SDK `colorRulesApply`): run a rule set directly —
  same shape as colorRules.set — WITHOUT loading it into the Set Color panel;
  the panel's rules/mode stay untouched — the form for external tooling that
  must not disturb the user's GUI. Internally the panel's Run and this share
  one rules→specs path (store scoping included). Demo gained an apply button
  (and its sample rule's opacity was fixed from 60 to 0.6 — the 0-1 scale).
  API `colorRules.set/add`: a rule's `store` scope (already honoured) is now
  typed in the SDK and documented, with unknown store names rejected
  (`not-found`) instead of silently matching nothing; the docs also show
  `level` and the `multi` per-line colour form.
- **2026.08.30** (>0.0.77):
  Fix: TREE_VIEW_ARGS (SQL Detail, Run / As Table / the color buttons) was
  seeded from the last VIEWPORT pick only, so after a tree click or U / P the
  SQL Detail panel kept showing the first-clicked item's attributes. It now
  follows the last selection root of any kind (tree click, viewport pick,
  U / P, API select), and SQL Detail re-runs on every selection change.
  Set Color: a "+" button at the start of every filter row inserts the LAST
  selected name (the current selection root — tree click, viewport pick or
  U / P) as the row's text; in Multi mode it is appended as a new line. A
  quick way to build a rule from what you are looking at.
  API: `tree.select` now also fires when U / P walk the selection up or down
  the hierarchy — the selection changes, so hosts following it get told.
- **2026.08.30** (>0.0.76):
  Hierarchy highlight now follows the actual item selection: a row whose
  items are ALL selected is highlighted and a row with SOME selected gets a
  blue left bar — at every level, collapsed or not — so invert, API and SQL
  selections show in the tree (they set no tree roots and used to show
  nothing). Derived from item state in the same lazy per-model pass as the
  hidden badges. API: `selection.get { items: true, maxItems }` returns every
  selected item's fullname (children included) with `itemCount` /
  `truncated`, for selections that have no roots — "item" meaning every
  selected NODE (grouping entries as well as the leaves), with
  `skip: ['FRAME', 'BRACKET*']` prefix filtering.
  Docs: EVENTS.md "Hosting: reverse-proxy the viewer under your own site"
  (and the SDK header) — framing tredespace.com directly makes the host's own
  panels/dialogs inside the viewer third-party (partitioned storage, no
  cookies/SSO, silent BroadcastChannel); serve the viewer through your own
  reverse proxy instead (nginx snippet), and host your own container / fork to
  lock a version. Spelled out for internal networks: tredespace.com is public,
  so internal panels would open inside a public-origin frame (frame-ancestors,
  SSO cookies) and clients would need internet access — proxied, the viewer is
  an internal URL and only the server talks to tredespace.com. Development
  note: a localhost host app framing the public viewer hits the browser's
  Private Network Access block when the viewer opens localhost panels — proxy
  in dev too (Vite `server.proxy` example) or disable the flag locally.
- **2026.08.29** (>0.0.75):
  Home ribbon: Sketch gets its own group — the Sketch toggle plus three mini
  buttons Off / Fill / Edges for the colour-from-mesh mode (ALT+1216/1217/1218),
  so switching modes no longer needs Settings → Edges. Sketch defaults changed
  to black ink with fade 0.10 (were grey `#a39d9d`, fade 0) — new installs and
  "Reset viewer defaults"; stored settings keep their values.
- **2026.08.29** (>0.0.74):
  SQL editor keys: Tab / Shift+Tab indent and outdent the selected lines (a
  caret gets one indent inserted / removed on its line), Enter keeps the
  current line's indentation; edits go through the browser's insert command so
  Ctrl+Z undoes them like typing. (`@treDeSpaceUI` SqlCodeEditor — README and
  gallery note updated.)
  TREE_VIEW_ARGS now holds the FULL tree-view path: the import-folder levels
  above the model (each folder row) as well as the entry chain, leaf first —
  it used to start at the model root, skipping the folders. The store band is
  chrome, not a level, and is not included.
  Fix: SQL Detail kept running the PREVIOUS query after a new "As Detail"
  from the SQL Editor (and after re-binding an edited saved report) — the
  click subscription was keyed on the report id, which the editor reuses.
  It now follows the bound report itself, clears the old fields, and re-runs
  the last viewport pick immediately so the new query answers without
  another click.
  SQL Editor: As Table, Color White, Color Hidden and Color Set (and every
  SQL Reports table/coloring run) now seed `TREE_VIEW_ARGS` from the last
  viewport pick, exactly as Run and detail queries do — so a detail-style
  query can be checked As Table with the values it will really see. The
  Console notes how many levels were seeded.
- **2026.08.29** (>0.0.72):
  Security: `?apiOrigins=` is no longer trusted blindly in a top-level window.
  Inside an iframe it works as before (storage partitioning means an embedder
  only ever sees the empty viewer it opened itself), but a window another page
  opened with `window.open` has the user's real OPFS/localStorage, so any site
  could open `viewer/?apiOrigins=https://evil` on a click and read every SQL
  database and asset over the API. Such a window now asks the user to
  Allow/Deny the requested origins; Allow saves them to Settings → External →
  API security (removable there) and completes the app.ready handshake for
  the host. A top-level window with no opener ignores the parameter.
  API: `clip.box.get` (SDK `clipBoxGet`) — the default clipping box's
  enabled/inverted flags, world-space min/max (axis-aligned envelope) and the
  exact center/size/rotation, so a host can load only the models that
  intersect it.
  Hierarchy context menu: "Disable / Enable item edges on selected" — item-
  boundary edge lines off (or back on) per item, undoable like a hide, hotkeys
  ALT+802 / ALT+803. Only visible while Settings → Edges → item edges is on;
  where an edge-off item meets one with edges on, the silhouette still draws
  on the other item's side. Costs nothing: the flag rides the item state the
  scene shader already reads and a spare bit of the G-buffer edge tag.
  Fix: after a viewport pick, collapsing a folder in the Hierarchy did
  nothing — the reveal had opened it under two keys (store-qualified and
  plain) and the chevron only removed one.
- **2026.08.29** (>0.0.71):
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
- **2026.08.28** (>0.0.71):
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
