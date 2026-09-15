# Code review — 2026-09-12 — closed findings

> Stuff that has been dealt with. Nothing here needs looking into again.

Split out of `REVIEW_20260912.md`, which now carries only what is still open.
Each finding is kept as it was written, with its severity struck through: the
original diagnosis is the record of WHY the change was made, and the line
numbers are the ones that were true when the review was taken — they have
moved since. What actually shipped is in CHANGELOG.md and DESIGN.md; this file
is the problem statement, not the implementation.

Entries closed by ruling rather than by a fix, kept here so they are not
re-proposed: 1.9, 6.1, 6.9 and 6.15 as **BY DESIGN** (the behaviour is
intended); 2a.10, 4.2, 4.5, the whole section-4 LOW tail (4.3, 4.7-4.18) and
5a.7, 5a.8 and the section-5 LOW tail (5a.5, 5a.6, 5c.1) as **DECLINED** — the cost is real
but the cure is riskier than the disease, or the information needed to do it
right has not arrived yet. The declined entries carry re-open conditions: what
would have to be true first, and which cheaper variant to try before the one
that was declined.

---

## 1. Memory leaks & performance (app layer)

- 1.1 ~~HIGH~~ **DONE** — a chunk-upload session has no owner-death or inactivity handling;
  Landed as proposed: sessions keyed by sender window (`uploadSessions.ts` registry, ownership checked on
  chunk / finish / abort), aborted from `dropClient` / `prune` via a new `onClientGone` hook, and a
  watchdog that expires a session whose owner closed or that saw no chunk for 2 minutes. Original: the import lock, the OPFS writable and the loading overlay stay stuck for the session.
  `handlersAssets.ts:505-523`: `assets.uploadBegin` takes `acquireImportLock()` (511), opens
  `createWritable()` on the `.part` file (521), stores the session in the module-level `uploads` Map (522)
  and shows `dialogs.loading` (523). Only `uploadFinish` / `uploadAbort` release. `clients.ts` never
  touches `uploads` (no reference), and there is no timer in the file.
  Scenario: a host iframe or tab starts an upload and is closed mid-way → every later import in every tab
  fails with "another import is already running" (the Web Lock in `assets.actions.ts:244-262` is held by a
  promise that never resolves), the overlay stays up, the partial file stays open.
  Fix: key sessions by sender window, abort them from `dropClient` / `prune`, and add an inactivity timeout
  that runs the `uploadAbort` path.

- 1.2 ~~HIGH~~ **DONE** — EXPLICIT model unload keeps the whole CPU model alive in the modeldb worker. Scope: the
  user / host "remove" path only — NOT the VRAM residency evict/revive cycle, which must keep state.
  Path: `viewerActions.removeModels` (GUI: Hierarchy context menu `HierarchyMenu.tsx:35,48`, Model Assets
  unload `assets.actions.ts:1157`) and `removeModelsQuiet` (API unload) → `viewer.actions.ts:296-303`:
  `residency.unregister` → `renderer.removeModels` → `db.removeModels` → `db.resetItemStates`.
  `db.removeModels` (`apiModels.ts:591-599`) sets `m.removed = true` and empties `selected`;
  `resetItemStates` (`dbState.ts:116-124`) zeroes `states` / `tidx` in place. Nothing is freed: the
  `DbModel` (`dbState.ts:60-118`) keeps `hierarchy` (all names), `childStart` / `childList`,
  `itemToEntry`, `states`, `tidx`, `baseColor`, `itemBounds`, `namesLower`, `hashIndex`, `bfsOrder`,
  `entryDepth`. `globalNameIndex.ts` keeps removed models' keys and skips them at lookup (lines 23, 50);
  only `clear()` (Unload all) frees anything.
  The residency (VRAM) path is separate and untouched by this finding: `residency.commit.ts` never calls
  `db.removeModels` — it calls `r.removeModels` (renderer only, lines 47, 195) and `db.repackModel*` /
  `db.statesFor`, so the DbModel and its per-item state stay live and the revive re-applies them. Same
  for GPU context-loss recovery: `gpuRecovery.ts:118-166` skips tombstoned slots (126), repacks every live
  slot with `db.repackModel` (164) and re-applies `db.statesFor` (142), so the DbModel and its state are
  reused there too. The one place recovery does drop a model is a slot whose restore FAILED
  (`gpuRecovery.ts:147-148`: `db.removeModels(lost)` + `db.resetItemStates(lost)`) — that is the same
  "gone from the viewer" semantic as an explicit unload, so the fix below applies to it as well.
  Scenario: load / unload many different large models in one session → each one's tables stay resident in
  the worker until "Unload all".
  Fix (explicit path + recovery's failed-slot path only): one worker call (e.g. `db.forgetModels`) that
  runs `removeModels` + `resetItemStates` and then drops the heavy tables, called from `removeModelsQuiet`
  and from `gpuRecovery.ts:147`; keep
  a slim tombstone `{name, group, store, itemCount, removed}` so slot indices stay stable; the slot-reuse
  revive (`viewer.actions.ts:121` `db.reviveModel`, which already re-parses the bytes via `repackForModel`)
  rebuilds hierarchy / name / bounds tables from that parse; drop removed models from the name index.
  Leave `residency.commit.ts` and `db.repackModel*` exactly as they are.

- 1.3 ~~HIGH~~ **DONE** — `Comlink.transfer` marks on nested `StateUpdate` objects are ignored, so every state change structured-clones all item states.
  `hierarchyIndex.ts:146-150` (`packStates`) marks the inner `{model, states}` object, but every API returns
  an ARRAY of them (`apiSelection.ts:28,55` and the other `StateUpdate[]` returns in apiSelection /
  apiVisibility / apiColor / apiTransform / apiModels). Comlink's `toWireValue`
  (`node_modules/comlink/dist/esm/comlink.mjs:310-330`) looks up `transferCache.get(value)` on the
  top-level return value only; it does not traverse arrays.
  Scenario: with millions of items loaded, each click / hide / colour / residency commit copies the full
  interleaved state array across the worker boundary instead of transferring it.
  Where: every worker API that mutates item state returns `StateUpdate[]` — 33 functions across
  apiSelection / apiVisibility / apiColor / apiTransform plus `statesFor` (residency swaps, GPU recovery,
  slot revive); the main thread consumes them in `viewer.actions.ts:149` `applyStateUpdates`, called from
  40 sites, which passes each array straight to `renderer.writeItemStates` (a `queue.writeBuffer`).
  Measured (Node 24, same V8 serializer as Chrome; `structuredClone` of `[{model, states}]` =
  serialize + deserialize, in the app split worker / main):

  | items in the touched model | array | interleave (worker, stays) | clone (today) | transfer |
  |---|---|---|---|---|
  | 0.1 M | 1.2 MB | 1.9 ms | 1.0 ms | 0.04 ms |
  | 1 M | 12 MB | 6.6 ms | 8.4 ms | 0.07 ms |
  | 5 M | 60 MB | 37 ms | 70 ms | 0.06 ms |

  So the avoidable part is the clone column, roughly half of it on the main thread, plus one transient
  copy of the array per update on each side. The interleave and the GPU upload stay either way, and the
  cost scales with the touched MODEL's item count (one zone file, not the scene), once per model per action.
  Fix: a `transferUpdates(updates)` helper returning
  `Comlink.transfer(updates, updates.map((u) => u.states.buffer))` at every return site.

- 1.4 ~~MEDIUM~~ **DONE** — Hierarchy: every expand / collapse wipes the children cache, reloads the model list and rebuilds twice.
  `useHierarchyTree.ts:85-110`: the "model list reload" effect lists `expanded` in its deps
  (`[expanded, rebuild, sel.modelsVersion, stores]`), so `toggle` (`setExp` + `rebuild`, lines 68-74)
  also re-runs it: `db.groups()`, `db.modelStores()`, `children.clear()`, then `rebuild(expanded)` again,
  which refetches children for every expanded node.
  Fix: key that effect on `modelsVersion` / `stores` only and let `toggle` own the rebuild.

- 1.5 ~~MEDIUM~~ **DONE** — Hierarchy rows are not virtualized.
  `HierarchyRows.tsx:25` renders `rows.map(...)` in full (3 icon components + tooltip attributes per row);
  no `useVirtualRows` anywhere under `panels/hierarchy`. The tree re-renders on every `actives` /
  `stateVersion` change. Fix: `useVirtualRows` (already in the library) with a fixed row height.

- 1.6 ~~MEDIUM~~ **DONE** — SQL Table result retained after the panel closes.
  Landed: not on unmount, which a layout swap also triggers — on a REAL close. `sqlTablePanel.ts` grew
  `clearTablePayload()` and a `clearOnClose` flag (default ON), the panel definition
  (`appPanels.ts`) got `onClose: handleSqlTableClose`, and the grid header carries a
  `Clear on close` / `Keep` toggle (hotkey `sql.table.clearOnClose`) so a slow report's
  result can be kept deliberately. Director's call: keeping the rows must stay possible,
  so make it a switch rather than always clearing. Original:
  `sqlTablePanel.ts:20-30`: module-level `payload` (rows up to the "Load all" cap + the `reload` closure)
  is never set back to null anywhere in `panels/sql-table`. Fix: clear on panel unmount.

- 1.7 ~~MEDIUM~~ **DONE** — `dialogs.loading` forces a `flushSync` commit on every call.
  `dialogs.actions.ts:36-38`: `flushSync(() => dialogsState.set({ loading: {...} }))` with a fresh object
  each call, so every progress tick is a synchronous React commit. Hot callers: STEP / IFC progress proxies
  (`assets.actions.ts:923,1007`), per-file (346), per-chunk upload (`handlersAssets.ts:543`).
  Fix: `flushSync` only on the null→shown transition; early-return when title / label / progress are unchanged.

- 1.8 ~~MEDIUM~~ **DONE** — viewport: the `gizmoLabelsState` subscription is never released.
  `viewport.ts:593-596`: `unsubLabels` is `void`ed with the comment "released with the panel below", but
  nothing in the file calls it (only lines 593 and 596 mention it). Each GPU-recovery `remountPanel`
  adds a subscriber closing over the dead renderer. Rare trigger, large retention. Fix: call it in dispose.

- 1.9 ~~LOW~~ **BY DESIGN** — multi-instance external panel definitions accumulate in the DockManager.
  Director's ruling: this works as intended — a host-registered panel definition is the host's to manage,
  and its remembered location is the point (reopening puts the panel back where it was). A host that does
  NOT want its definition to outlive a close should unregister it itself (`remove === true`). Not changed.
  Original:
  `useAppStartup.ts:150` and `ExternalAppButton.tsx:45` register a fresh def per open;
  `ExternalPanelBody.tsx:26-38` unregisters only when `remove === true`. Closing via the tab ✕ leaves the
  def and its remembered location. Fix: unregister multi-instance ids in the close path when the layout no
  longer holds them.

- 1.10 ~~LOW~~ **DONE** — SQLite worker client installs `onmessage` only.
  Landed: `onerror` and `onmessageerror` now run a shared `#teardown(msg)` — the path `killWorkerThread()`
  already used — so a crashed worker settles every pending `execute()` with that message and releases every
  held Web Lock instead of hanging the tab (and every other tab waiting on those files). The failure is
  logged to the Console panel. `postChannel` deleted. Original:
  `SqliteWorkerClient.ts:31`: no `onerror`, so a wasm trap / OOM in the worker never rejects the pending
  `execute()` and the Web Lock callback never resolves in that tab. `postChannel` (line 133) has no
  callers in `src` (dead code). Fix: `worker.onerror` → the kill / cleanup path; delete `postChannel`.

- 1.11 ~~LOW~~ **DONE** — `dialogs.confirm` overwrites a pending resolver.
  Landed: queued rather than dropped — `confirm` and `prompt` each keep a FIFO of
  `{ dialog, resolve }`, the state shows the head, and answering shifts it and shows the next. `prompt`
  had the same bug and is fixed with it; its state carries a `seq` the component keys on, so a queued
  prompt remounts and takes focus instead of silently reusing the previous field. Original:
  `dialogs.actions.ts:58-77`: a second concurrent confirm replaces `pendingConfirm` without resolving the
  first, so the first awaiter never settles. Fix: queue, or resolve the previous with `false`.

---

- 1.12 ~~LOW~~ **DONE** (2026-09-15, closed with 6.14) — API client registry prunes lazily.
  Nothing separate to do: this was the section-1 cross-reference to 6.14, and that landed on 2026-09-13 —
  `dropClientsForDialog(id)` is called from `externalPanelsActions.close` and the modal's
  `removeExternalModal`, so a removed iframe's entry (a strong `Window` ref) no longer outlives the panel.
  See § 6 for the diagnosis.

## 2. Widgets (`src/treDeSpaceUI`)

Inventory: 20 exported widgets (Button, Checkbox, RadioGroup, TextInput/TextArea,
NumberInput, Select, ColorSelect, Date/Time/DateTime pickers, Collapsible,
InlinePanel, InfoBox/InfoButton, VerticalTabs, FileTree, SqlCodeEditor,
Modal/TitleBar, 4 `*DialogCore`s, Ribbon family, Tooltip, useFilePicker) plus
`lib` (cn, createStore, useVirtualRows), `dockable`, `hotkeys`. Useful internals
that are NOT exported (`widgets/index.ts` has no reference): `Labelled` /
`fieldCls` / `ClearButton` (`widgets/fieldChrome.tsx`), `PickerField` /
`PickerPopover`, `usePopoverAnchor`, `FileTreeMenu`. The gallery has a tab per
exported widget. The ribbons and settings tabs use the library cleanly; the gaps
cluster in list/row layout, menus, dialog frames and feedback.

Everything below landed in one pass (CHANGELOG 2026.09.13, >0.0.118). The one
finding still open — the full `DataGrid` extraction — stays in the open list;
its virtualization-hook half landed here.

### 2a. Missing widgets (ranked by how many places would use them)

- 2a.1 ~~MEDIUM~~ **DONE** — `FieldRow` / labelled wrapper for Select, NumberInput, ColorSelect (~20 sites).
  Landed: `Labelled` is exported and Select / NumberInput / ColorSelect take `label` / `labelPosition` (`top` | `left` | `split`) / `labelWidth` / `fieldWidth` like the text fields. Both `Row` copies are deleted and every site listed here now passes the props. Original: `Labelled` exists in `fieldChrome.tsx` but is only wired into TextInput/TextArea. Panels hand-roll
  `<label class="flex items-center gap-2"><span class="w-14 shrink-0">…</span><div class="min-w-0 flex-1"><Select/></div></label>`:
  `import-manager/importWidgets.tsx:62-72,85-100`, `import-manager/optionRows.tsx` (3 row helpers),
  `import-manager/MergedGlbSection.tsx:56-70`, `measurements/MeasurementsConfigSection.tsx:16-66` (4 rows),
  `sql-editor/SqlEditorDbRow.tsx:14-32`, `sql-reports/ReportEditorFields.tsx:20-38`,
  `sql-reports/SqlReports.tsx:38-49`, `sql-reports/ReportFilterInput.tsx:30-42`,
  `sql-reports/DropdownFilterFields.tsx:31-46`, `labels/LabelsImportSection.tsx:40-46`,
  `export/ExportSnapshotSection.tsx:11-27`, `multi-color/RuleEditor.tsx:74-116`,
  `model-assets/AssetsLibraryTree.tsx:100-107`, `model-assets/StoreSelectionRows.tsx:57-63`,
  `sql-assets/SqlAssetsToolbar.tsx:36-48`. Two app-level `Row` components duplicate each other:
  `settings/Row.tsx` (`w-28`, imported by 14 files) and a private copy in
  `labels/LabelsStyleSection.tsx:7-14` (`w-32`).
  Fix: export `Labelled`; give Select / NumberInput / ColorSelect `label`, `labelPosition`, `labelWidth` like TextInput.

- 2a.2 ~~MEDIUM~~ **DONE** — `ContextMenu` / `Menu` (3 implementations, all different).
  Landed: `Menu` (portaled, measured-and-clamped, outside-press + Escape close, items with icon / tooltip / shortcut / disabled / danger, `{ separator: true }`, falsy entries skipped). HierarchyMenu, TableMenu and FileTree all consume it; `FileTreeMenu.tsx` is deleted. Original: `hierarchy/HierarchyMenu.tsx:50-123` (7 raw buttons, `fixed z-50`, not portaled, not viewport-clamped),
  `sql-table/TableMenu.tsx:60-98` (portaled, clamps with hard-coded sizes, closes on window pointerdown),
  lib-internal `filetree/FileTreeMenu.tsx` (portaled, clamps, closes on mouseleave).
  Needs: items with label / tooltip / shortcut / disabled / danger, separators, anchor `{x,y}`,
  outside-press close, clamping. FileTree should then consume it.

- 2a.3 ~~MEDIUM~~ **DONE** — `DialogFrame` + Button variants for dialog footers.
  Landed: `DialogFrame({icon,title,width,height,maxHeight,onClose,role,footer,bodyClassName})`; `TitleBar` has `onClose`. The three dialog cores, LoadingDialogCore, LicenseDialog and ThirdPartyNotices are all the frame plus content; ExternalModalBox uses TitleBar with its ✕. Original: Every dialog repeats `w-80 border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl` plus
  hand-rolled footer buttons: lib-internal `ConfirmDialogCore.tsx:28-46`, `PromptDialogCore.tsx:50-67`,
  `ErrorDialogCore.tsx:20-29`; app `settings/about/LicenseDialog.tsx:53-66` and
  `ThirdPartyNotices.tsx:41-54` (both add a raw ✕ inside `TitleBar` and wire Escape by hand);
  `ribbon-external/ExternalModalBox.tsx:12-40` (own title bar + ✕).
  Fix: `DialogFrame({icon,title,width,maxHeight,onClose,footer})` with `TitleBar onClose`; collapses all six.

- 2a.4 ~~MEDIUM~~ **DONE** — `SegmentedControl` / `ToggleGroup` (~8 sites).
  Landed: `SegmentedControl`, generic over the value union, with `size` / `grow` / `fill`. Adopted in TransformStepGroups, ClipShapesCommonSection (gizmo mode), RuleEditor, LabelsFileRows, HierarchySearch and StoreSelectionRows. The two GRID-shaped groups (MeasureToolGroups locks, MeasureSnapGroups corners/edges) deliberately keep Buttons — a single-row run is the wrong shape for them, and the snap toggles are not even exclusive. Original: Inline exclusive choice rendered as a run of `Button active` or raw buttons:
  `ribbon-selection-transform/TransformStepGroups.tsx:33-50` (raw buttons copying Button's class string),
  `ribbon-measurements/MeasureToolGroups.tsx:66-80`, `MeasureSnapGroups.tsx:30-52`,
  `clip-shapes/ClipShapesCommonSection.tsx:118-149`, `multi-color/RuleEditor.tsx:95-108`,
  `hierarchy/HierarchySearch.tsx:49-55` + `model-assets/StoreSelectionRows.tsx:78-84` (exact/contains
  toggle, two looks for one concept), `labels/LabelsFileRows.tsx:60-69` (a Select for two options).
  RadioGroup is vertical native radios, not this.

- 2a.5 ~~MEDIUM~~ **DONE** — Toast / non-blocking notification + `dialogs.info`.
  Landed: `toast` + `<Toaster/>` (bottom-right above the modal layer, hover-to-hold, errors stay until dismissed, capped at four) and `dialogs.info` / `success` / `warn` on top of it. Every `confirm(..., {okLabel:'OK'})`-as-alert now raises a toast. `CopyButton` owns the "Copied" timer at both sites. Original: No toast exists; the hotkey announcer is routed to the Console (`src/hotkeys/bindings.ts:3425`).
  `dialogs.confirm('Loaded N…', {okLabel:'OK'})` is used as an alert in `labels/LabelsFileRows.tsx:24,26`,
  `measurements/useMeasurementsImport.ts:15,17`, `clip-shapes/ClipShapesCommonSection.tsx:20,22`,
  `settings/shortcuts/useShortcutsEditing.ts`; "Copied" timer state is hand-rolled in
  `settings/rendering/VramBudgetSection.tsx:27-33,137` and `settings/stats/StatsReadout.tsx:52-58`
  (→ a `CopyButton`).

- 2a.6 ~~MEDIUM~~ **DONE** — `EmptyState` (10 sites, 3 styles).
  Landed: `EmptyState` (`note` | `center`). All nine `.note` paragraphs and both centred PanelBody texts use it. Original: `<p className="note …">` (an APP class) in 9 files: `clip-shapes/ClipShapes.tsx:29`, `console/Console.tsx:78`,
  `hierarchy/Hierarchy.tsx:56`, `HierarchySearch.tsx:56`, `measurements/MeasurementsListSection.tsx:20`,
  `model-assets/ModelAssets.tsx:38`, `sql-assets/SqlAssets.tsx:74`, `sql-detail/SqlDetail.tsx:97`,
  `sql-reports/SqlReports.tsx:63`; centered PanelBody text in `sql-table/SqlTable.tsx:14-18`,
  `SqlDetail.tsx:29-33`; InfoBox in Viewpoints / Hierarchy.

- 2a.7 ~~MEDIUM~~ **DONE** — `Badge` / `Tag` with tone.
  Landed: `Badge` with tone, plus `badge` on Button. Adopted in ReportRow, TableGrid, ThirdPartyNotices, SqlEditorStatus, ViewpointRow and ViewpointEditBar. `HiddenBadge` deliberately stays a bare status ICON — boxing it in a chip would be noise in a 22px tree row. Original: `viewpoints/ViewpointRow.tsx` aside, `sql-reports/ReportRow.tsx:41`, `sql-table/TableGrid.tsx:50`,
  `about/ThirdPartyNotices.tsx` license, `sql-editor/SqlEditorStatus.tsx:36-48`,
  `viewpoints/ViewpointEditBar.tsx:15`, `hierarchy/HiddenBadge.tsx`. RibbonButton has `badge`; Button does not.

- 2a.8 ~~MEDIUM~~ **DONE** — `PanelHeader` (title + aside + actions row) (6 sites).
  Landed: `PanelHeader` with `label` / `title` / `band` variants. All six sites use it. Original: `import-manager/ImportManager.tsx:38-45`, `quick-colors/QuickColors.tsx:21-28`, `shared/StoreAdmin.tsx:11-13`,
  `sql-table/TableGrid.tsx:46-64`, `sql-detail/SqlDetail.tsx:41-77`, `viewpoints/ViewpointEditBar.tsx`.

- 2a.9 ~~MEDIUM~~ **DONE** — `PropertyList` (key/value rows) + `Kbd`.
  Landed: `PropertyList` (`fixed` | `fill`, `numeric`, `divided`) and `Kbd`. SqlDetail, StatsReadout and CameraControlsSection use them; ShortcutRow's binding chip is now `Button readOnly`. Original: `sql-detail/SqlDetail.tsx:81-96` (`<dl>`), `settings/stats/StatsReadout.tsx:20-32,66-72` (grid),
  `settings/shortcuts/CameraControlsSection.tsx:29-38`, `ShortcutRow.tsx:24-47` (binding chip with
  custom / recording tones — Button has a `readOnly` prop, `Button.tsx:15`, that ShortcutRow does not use).

- 2a.10 ~~MEDIUM~~ **DECLINED** (2026-09-15, re-open when a SECOND consumer appears) — `DataGrid`: the full extraction.
  Director's ruling: the useful half already landed — `sql-table/useTableLayout` drives `useVirtualRows`
  instead of re-implementing it, and `usePointerDrag` owns the column resize. What is left is moving a
  generic virtualized / sortable / filterable / resizable grid
  (`sql-table/{TableGrid,TableHeader,TableBody,useTableLayout,useTableView,useTableSelection}`) into the
  library while it has exactly ONE user, which means inventing an API instead of deriving one — and a
  library widget is a promise to keep it stable. Re-open the moment a second panel needs a grid: that
  consumer is what tells us which props are really generic and which are SQL-table specifics.

- 2a.11 ~~MEDIUM~~ **DONE** — generic `TreeView` (big refactor, schedule with care).
  Landed: `TreeView` — a virtualized tree over a flat list of visible rows, with indent, twisty, selection, partial bar, bands and a `rowProps` escape hatch for drag-and-drop. Hierarchy, the Hierarchy search results and FileTree all render through it; `FileTreeRow.tsx` is deleted and the app tree CSS with it. Original: `hierarchy/HierarchyRows.tsx` + `HierarchySearch.tsx` hand-roll a tree on app CSS
  (`.tree`, `.tree-row`, `.is-selected`, `.partial-bar`, `.scroll-slim` in `src/styles.css:157-234`).
  FileTree is file-shaped and not virtualized; a shared row / expand / partial-selection core would serve both.

- 2a.12 ~~MEDIUM~~ **DONE** — small ones. `Link` (3 styles: `importWidgets.tsx:9-15`, `sql-detail/DetailValue.tsx:8-17`,
  Landed: `Link`, `Vec3Input`, `Swatch`, `Spinner`, `ProgressBar` and `usePointerDrag` all landed and are adopted at the listed sites — the drag hook is now the single path for the number scrubber, the column resize and the external-modal move/resize. Original: `ThirdPartyNotices.tsx`), `Vec3Input` (`clip-shapes/ShapeRow.tsx:94-140`), `Swatch` button
  (`labels/LabelsListSection.tsx:19-25`), `Spinner` / `ProgressBar` (only inside LoadingDialogCore;
  `ThirdPartyNotices` shows "Loading…" text), `usePointerDrag` (drag logic duplicated in
  `useTableLayout.startResize`, `ribbon-external/useModalDragResize.ts`, NumberInput).
  Not missing in practice: horizontal Tabs, slider, breadcrumbs, pagination, file drop zone.

### 2b. Should adopt an existing widget

- 2b.1 ~~MEDIUM~~ **DONE** — `settings/Check.tsx` (40 lines) duplicates `Checkbox` (51 lines) almost line-for-line;
  Landed: deleted; all 14 files import `Checkbox`. Original: imported by 14 settings files. Delete it.

- 2b.2 ~~MEDIUM~~ **DONE** — raw `<label><input type="checkbox">` (~20 occurrences): `export/ExportClipCheck.tsx`,
  Landed: all of them are `Checkbox` now (the SQL Table's select-all corner included, via `indeterminate`). The only raw checkbox left in `src` is the one inside the widget. Original: `export/SnapshotCheck.tsx`, `export/ExportGlbSection.tsx:29-40`, `import-manager/importWidgets.tsx:28-58`,
  `import-manager/StdGlbSection.tsx:53-74`, `import-manager/optionRows.tsx:70-96`, `labels/LabelsStyleSection.tsx` (3),
  `labels/LabelsImportSection.tsx:33-38`, `measurements/MeasurementsConfigSection.tsx:48-55`,
  `model-assets/StoreSelectionRows.tsx:50-55`, `sql-detail/SqlDetail.tsx:71-76`, `sql-reports/ReportTypeToggles.tsx:14-18`,
  `settings/stats/StatsReadout.tsx:20-26`, `ribbon-layout/RibbonLayout.tsx:70-86`.

- 2b.3 ~~MEDIUM~~ **DONE** — `ViewpointViewer.tsx:75` and `ReportRow.tsx:57` use raw `dangerouslySetInnerHTML` with
  Landed: both use `components/shared/RichText` (which grew a `block` prop for the paragraph case). Original: `richTextHtml` instead of `components/shared/RichText.tsx` (one rendering path, not two).

- 2b.4 ~~MEDIUM~~ **DONE** — `hierarchy/HierarchySearch.tsx:30-48` hand-rolls search input + clear ✕ → `TextInput type="search"`.
  Landed: `TextInput type="search"` — the hand-rolled input and ✕ are gone, and the match toggle is a SegmentedControl. TableHeader's dense filter cells stay raw, as the finding allowed. Original: `TableHeader.tsx:75-84` filter inputs are raw too (defensible as dense grid cells).

- 2b.5 ~~MEDIUM~~ **DONE** — `panels/toolbar/Toolbar.tsx` is not referenced from `appPanels.ts` or any component; uses app
  `.btn` / `.toolbar` classes and raw buttons. Delete.

- 2b.6 ~~MEDIUM~~ **DONE** — `sql-reports/ReportRow.tsx:33-47` hand-rolls a Collapsible header to get an Edit button;
  Landed: uses `Collapsible` with `actions` (and `open` / `onToggle`, so the panel keeps owning which report is open). Original: `Collapsible` has an `actions` prop.

- 2b.7 ~~MEDIUM~~ **DONE** — `import-manager/optionRows.tsx:36-68` `OptionNumberRow` renders the unit as a trailing span instead
  of NumberInput's `unit` prop; `MergedGlbSection.tsx:66` same.
  Landed: both use NumberInput's `unit` (and `optionRows.tsx` is deleted — the widgets carry the label props now).

- 2b.8 ~~MEDIUM~~ **DONE** — lib-internal `PromptDialogCore.tsx:38-48` uses a raw `<input>` instead of `TextInput` (needs an `autoFocus` prop).
  Landed: uses `TextInput`, which gained `autoFocus` (a ref callback, so no a11y-lint escape hatch).

### 2c. Missing props / variants on existing widgets

- 2c.1 ~~MEDIUM~~ **DONE** — Button: no `variant` (`primary` / `danger` — `HierarchyMenu` / `FileTreeMenu` hand-colour; dialog cores
  Landed: Button has `variant`, `size`, `wrap`, `grow`, `loading` and `badge`; every class-string override listed here is gone. Original: hand-roll primary/ghost), no `size` (overrides: `h-4 w-4` `SettingsSection.tsx:29`, `h-5 w-5` `FilterEditRow.tsx:26`,
  `h-5 px-2 text-[10px]` StatsReadout, `h-6 px-2 text-[11px]` VramBudgetSection, `h-auto min-h-5` ConsoleToolbar / TableGrid),
  no `wrap` / `grow` (the string `h-auto min-h-6 flex-1 py-1 leading-tight` is pasted 12× across sql-assets /
  model-assets / import-manager), no `loading`, no `badge`.

- 2c.2 ~~MEDIUM~~ **DONE** — Select / NumberInput / ColorSelect have no `tooltip` / `shortcut` prop (`Select.tsx` and
  Landed: `tooltip` / `shortcut` on Select, NumberInput, ColorSelect, TextInput and TextArea; `label` too (see 2a.1). `multi-color/Tip.tsx` is deleted and the hand-placed `data-tooltip` wrappers with it. Original: `NumberInput.tsx` contain no `tooltip`), so panels wrap them in hand-placed `data-tooltip` attributes
  (46 such lines under `panels/`, outside Button / RibbonButton / Checkbox) and `multi-color/Tip.tsx`.
  This also contradicts the "every control has a hotkey + tooltip" rule. No `label` either (see 2a.1).

- 2c.3 ~~MEDIUM~~ **DONE** — Select / RadioGroup `value: string` forces 11 `as` casts in `onChange` handlers across
  Landed: Select, RadioGroup and SegmentedControl are generic over `T extends string`. All 11 casts are gone; `src/components` has no `as` on a widget prop left. Original: `src/components` (`v as FilterRow['op']`, `x as 'orbit'|'fly'|'walk'`, `(v ?? 'medium') as ExternalAppSize`…)
  against the no-`as` rule. Make them generic over `T extends string`.

- 2c.4 ~~MEDIUM~~ **DONE** — Collapsible is uncontrolled only (`defaultOpen` + internal `useState`, `Collapsible.tsx:17,41`)
  Landed: `open` / `onToggle` (plus `bodyClassName`). ShortcutsSettings uses Collapsible instead of re-implementing it, and ViewpointRow's `key` remount hack is gone. Original: → `ShortcutsSettings.tsx:86-112` re-implements it (search must open groups), `ViewpointRow.tsx:24` uses a
  `key={`${vp.id}:${expanded}`}` remount hack. Add `open` / `onToggle` like InlinePanel.

- 2c.5 ~~MEDIUM~~ **DONE** — Modal has no `onClose` (`Modal.tsx` contains neither `onClose` nor `Escape`) — every caller wires
  Landed: Modal has `onClose` (Escape via a modal STACK, so only the top dialog closes, plus a backdrop press and `closeOnBackdrop`), TitleBar has `onClose`, and width / height / maxHeight / scroll body live on DialogFrame (2a.3). Original: Escape by hand (`LicenseDialog`, `ThirdPartyNotices`, `ConfirmDialogCore`, `PromptDialogCore`); no width /
  maxHeight / scroll body (see 2a.3). `TitleBar` has no `onClose` ✕.

- 2c.6 ~~MEDIUM~~ **DONE** — InfoBox is amber only (`InfoBox.tsx:13-15`) → needs `tone: info|warning|error|success` (hand-rolled:
  Landed: `tone: neutral | info | success | warning | danger` on InfoBox, from the shared `Tone` scale Badge and the toasts use. Every hand-rolled coloured note listed here is an InfoBox or a Badge now. Original: red block `StatsReadout.tsx:76-90`, amber text `StatsTab.tsx:47`, `StepSection.tsx:53`,
  `ExternalAppPolicyEditor.tsx:57`, rose text `SqlDetail.tsx:108`, `SqlEditorStatus.tsx`).

- 2c.7 ~~MEDIUM~~ **DONE** — Checkbox has no `indeterminate` (`TableHeader.tsx:16-25` fakes tri-state with icons).
  Landed: Checkbox has `indeterminate`; TableHeader uses it instead of faking tri-state with icons.

- 2c.8 ~~MEDIUM~~ **DONE** — TextInput has no `autoFocus`, no `onKeyDown` passthrough.
  Landed: TextInput has `autoFocus` (via a ref callback, so no a11y-lint escape) and an `onKeyDown` passthrough that runs before its own Enter handling.

### 2d. App-style leakage (would break in the gallery / npm package)

- 2d.1 ~~MEDIUM~~ **DONE** — panels lean on `src/styles.css` classes: `.note` (9 files, see 2a.6), `.tree` / `.tree-row` /
  Landed: no file under `src/components` references an app CSS class any more. Original: `.is-selected` / `.partial-bar` / `.scroll-slim` (`hierarchy/HierarchyRows.tsx`, `HierarchySearch.tsx`),
  `.btn` / `.toolbar` / `.brand` / `.dim` / `.grow` (dead `Toolbar.tsx`).
  The library itself is clean: no lib file references app CSS or app modules.

- 2d.2 ~~MEDIUM~~ **DONE** — unused app CSS: `.field`, `.check`, `.row`, `.swatches`, `.dot-*` in `styles.css:96-231` appear unused
  Landed: deleted. `src/styles.css` is down to the page shell plus `.panel-body.strip`. Original: (demo leftovers). `.panel-body` is passed by every panel but only `.panel-body.strip` is defined (harmless).

### Done well
- Ribbons and settings tabs use the library consistently.
- The library has no dependency on app CSS or app modules; the gallery covers every exported widget.

---

---

## 3. Import / export performance

- 3.1 ~~HIGH~~ **DONE** — MD5 of every imported file runs synchronously on the main thread over the whole file.
  `assets.actions.ts:527-528` (`file.arrayBuffer()` then `md5Hex(new Uint8Array(bytes))`) and `:617`;
  `md5.ts` is a scalar DataView implementation (`block(dv, off)` at 92). The file is also fully read on the
  main thread first. With a cooker pool, the runners serialize their hashes on the same thread, so a folder
  import stacks the freezes.
  Fix: hand the worker the `File` (structured clone of a File is a reference), stream it once in
  `cookerWorker` — `Md5.update` per chunk while filling the wasm input / sync-writing the `.tdp` copy —
  and return the hex with `CookOutcome`. The incremental `Md5` class and the `md5OfStream` pattern already
  exist (`sqlAssets.actions.ts:51`).

- 3.2 ~~HIGH~~ **DONE** — GLB export allocates vertex buckets sized by INDEX count.
  `apiExport.ts:165-210`: pass 1 sums `cullU[mi * 9 + 5]` (index count) per bucket and allocates
  `pos: new Float32Array(c.n * 3)`. A meshlet holds at most 64 vertices for up to 124 triangles
  (`cook.rs:20-21`, i.e. 372 indices), so the position allocation can be up to 372/64 ≈ 5.8× what the unique
  vertices need; a large merged export can fail the allocation outright.
  Same file: `bucketKeyOf` (line 178) builds a string key per meshlet in both passes, and `itemColor` /
  `colorKey` are recomputed in pass 2 (211-219).
  Fix: count meshlets per bucket in pass 1 and cap at `min(indexCount, meshlets × 64) × 3`, or run the
  remap in pass 1 for exact counts; numeric key (`item * 2**32 + ck` fits a double); cache pass-1 results
  per meshlet in a `Uint32Array`.

- 3.3 ~~HIGH~~ **DONE** — `.tdp` export re-cooks through the TS cooker with plain-array byte pools.
  `export.actions.ts:224` → `cooker.cookOpfsGlbToTdp` → `cookerWorker.ts:82-88` → `cookGenericGlb`
  (`cook.ts`). `assemble()` pushes every quantized byte into plain JS arrays (`cook.ts:468` `descs.push(...spread)`,
  `473` `pool.push(q & 255, q >> 8)`, `482/485` `tris.push`) then copies with `Uint8Array.from` (513-516):
  number arrays with doubling growth, then a full copy. The wasm cooker (byte-identical, 4× faster) is bypassed
  because the export GLB is not "merged". The GLB also round-trips through OPFS (`temp/export/model-i.glb`
  written by modeldb, re-read whole by the cooker at 83).
  Fix: a wasm entry that takes flat `positions / indices / ranges / hierarchy` (the `MergedModel` shape the
  converters already use) called from the modeldb worker directly; or have `glbWrite` emit the extras
  `cook()` expects. Short term: pre-size typed arrays in `assemble` (vertex / tri totals are known).

- 3.4 ~~HIGH~~ **DONE** — merged-GLB import parses and cooks the whole GLB twice for the coarse variant.
  `cookerWorker.ts:45` `cook(u8, false, false)` then `:55` `cook(u8, false, true)`: each call copies the GLB
  into wasm (`&[u8]`), re-parses it and recomputes item boxes, spatial sort and dense bounds. The RVM and IFC
  converters do the same via `cook_model(model.clone(), c)` (`rvm-wasm/src/lib.rs:447`,
  `ifc-wasm/src/lib.rs:340`), cloning every position / index buffer inside a wasm heap that never shrinks.
  STEP already avoids this with `coarsen_full` (`step-wasm/src/lib.rs:406,548`).
  Fix: one wasm entry returning `(full, coarse)` from a single parse, sharing item boxes / dense bounds /
  spatial order, coarsening on a borrowed index copy only. Verify byte parity with the `direct_cook` tests.

- 3.5 ~~MEDIUM~~ **DONE** — residency swaps read whole `.tdp` files on the main thread and re-parse both variants on every mixed repack.
  `residency.commit.ts:62`, `:98-99` (full + coarse), `:149`: `readFile(...)` on the main thread, transferred
  to the worker; `apiModels.ts:269` then `parseModel(m.name, fullBytes)` decodes every meshopt stream again
  per repack. Repacks are triggered by eye movement among other things (`residency.ts:264-281`,
  `VIS_MOVE_M`), so a zone the camera moves through is re-read and re-decoded repeatedly.
  Fix: pass the OPFS path and read inside the modeldb worker (`opfsReadFromRoot`, `opfsSyncWrite.ts:144`,
  already exists); keep a small LRU of parsed full variants so consecutive mixed repacks of the same zone
  skip the decode. The same main-thread read applies to asset load (`assetBytes.ts:19-24`) and export from
  disk (`export.actions.ts:40`).

- 3.6 ~~MEDIUM~~ **DONE** — cooker-core hot loops: default-hasher HashMap per draw range, allocating sort keys, string compares.
  Landed: every part of it. `cell_of` uses `[usize; 3]` and its result is computed ONCE per draw range (it was the `sort_by_key` comparator AND the cell table's input); the hierarchy sort is `sort_by_cached_key`; the per-node range filter is replaced by one bucketing pass (it was O(nodes × ranges) — quadratic on exactly the big merged GLBs); the per-draw-range `HashMap` compaction is a generation-stamped flat array reused across a colour group's ranges; and `rustc-hash` backs the keyed maps. Cooked output is byte-identical — checked by cooking the Huldra RVM sample on both revisions and comparing digests of the full AND coarse variants. On that sample the cook is ~4% faster; the quadratic and per-range-allocation fixes scale with item count, which the committed samples are too small to show. Original: `cook.rs:677` `global_to_local: HashMap<u32, u32>` allocated per draw range and probed for every index;
  `:66-83` `cell_of` allocates two `Vec<usize>` per call and is the `sort_by_key` key at `:377`
  (evaluated O(n log n) times); `:316` `hierarchy.sort_by(|a, b| a.id.to_string().cmp(&b.id.to_string()))`
  allocates two Strings per comparison; `:258-266` filters ALL draw ranges once per node
  (O(nodes × ranges)). No `fxhash` / `ahash` / `rustc-hash` crate is in the workspace.
  Fix: a reusable generation-stamped `Vec<u32>` scratch for compaction; `[usize; 3]` in `cell_of` and
  precompute cells once; `sort_by_cached_key` for the hierarchy; group draw ranges by node in one pass;
  `rustc-hash` for the keyed maps (also the RVM dedup maps).

- 3.7 ~~MEDIUM~~ **DONE** — cooked output crosses wasm→JS with two copies.
  Landed: the byte getters MOVE instead of cloning (`std::mem::take` / `Option::take`) in cooker-wasm (`CookResult.bytes` / `.coarse`), ifc-wasm (`ConvertedFiles.bytes`), rvm-wasm and step-wasm — wasm-bindgen still copies once into the JS `Uint8Array`, which is unavoidable, but the wasm-side clone is gone. Every caller already read each payload exactly once; the d.ts now says a second read yields an empty array. All four wasm binaries rebuilt. Original: `cooker-wasm/src/lib.rs:16-19`: the `bytes` getter clones the `Vec<u8>` inside wasm, then wasm-bindgen
  copies it again to a JS `Uint8Array` (`cookerWorker.ts:46` notes the copy). Same in
  `ifc-wasm/src/lib.rs:146` (`blobs.get(i).cloned()`). Check `rvm-wasm` / `step-wasm` for the same pattern.
  Fix: consuming accessors (`into_bytes(self)` / `take(i)` with `std::mem::take`) so only the wasm→JS copy
  remains, or `js_sys::Uint8Array::from(&v[..])` without the intermediate clone.

- 3.8 ~~MEDIUM~~ **DONE** — cooker pool default is 10 with no `hardwareConcurrency` clamp.
  `assets.state.ts:146` `pool: 10`; `cookerPool.ts:5` spawns that many workers; no `hardwareConcurrency`
  reference in the file. Each worker holds a full GLB + wasm parse + output at peak.
  Fix: `Math.max(1, Math.min(pool, (navigator.hardwareConcurrency ?? 4) - 1))`; same for `loadPool`.

- 3.9 ~~MEDIUM~~ **DONE** — export reads every model's geometry into main memory before the worker starts.
  Landed: the main thread no longer holds every model at once. The worker gained an export SESSION (`beginExport` / `addExportGeoms` / `finishExportGlb` / `finishExportIfc` / `abortExport`): the GLB and IFC exports now read one model, transfer it, and let the worker decode it into the accumulating tree before the next readback — so main-thread peak is one model instead of all of them. Readback of model i+1 overlaps the decode/build/cook of model i in all three exports (the TDP one too). NOT done: flushing each model to the output file as it is added — the GLB container writes its JSON chunk (accessors, bufferViews) before the binary chunk, so the node tree has to be complete before a single byte is written. That is a container rewrite, not a streaming tweak. Original: `export.actions.ts:54-78` `readGeoms` loops `readModelGeometry` (`renderer.ts:1700` mapped-range `.slice(0)`,
  necessary) or a whole-file OPFS read, keeps all of it, then transfers the lot (136 / 277); the worker then
  holds all packed geometry plus all buckets. `exportTdp` (195-245) is per-model but strictly serial across
  its three workers.
  Fix: stream one model at a time (`beginExport / addModel / finishExport`) so the GLB / IFC writers flush
  each model before the next readback (the writers already stream); overlap readback of model i+1 with the
  cook of model i.

- 3.10 ~~MEDIUM~~ **DONE** — IFC import holds the input three times and clones meshes per split group.
  Landed: `to_mesh` takes the upstream `MeshData` BY VALUE, so indices, normals, UVs and the texture move across instead of being cloned (a full second copy of the model's geometry), and `emit_files` MOVES each mesh into its bucket instead of `meshes[i].clone()` — with split = none that clone was the whole model again. Byte-identical output, checked by hashing every sample's every output on both revisions. NOT done: staging the input to OPFS and reading it by range like STEP — the review called that the longer-term half, and it is an architecture change to the IFC front end rather than a clone removal. Original: `assets.actions.ts:917` reads the IFC into a main-thread `ArrayBuffer`, `ifc2glbWorker.ts:49` passes
  `new Uint8Array(bytes)` → `&[u8]` (copied into wasm memory), then `ifc-core/src/convert.rs:554`
  clones every `Mesh` per group (`meshes[i].clone()`) and `:684` clones `m.indices`.
  Fix: `into_iter()` / index-based borrowing in bucket + emit; longer term stage to OPFS and read by range
  like STEP.

- 3.11 ~~LOW~~ **DONE** — RVM streaming output copies each cooked file twice in JS.
  Landed: each chunk is transferred to the writer AS IT ARRIVES with an append cursor, so a cooked file is never held whole on either side and never concatenated. The writer keeps one sync access handle open per file (`{name, at, bytes}` chunks, then `{name, end}`), and an output that will be discarded is now recognised at `open` — its chunks are never copied or posted at all. Original: `rvm2glbWorker.ts:107` `bytes.slice()` per chunk, then `:118` concatenates into one buffer per file
  before transferring to the writer. Fix: post each chunk to the writer as it arrives with an append cursor.

- 3.12 ~~LOW~~ **DONE** — URL import buffers the whole download, then hashes it in a separate main-thread pass.
  Landed: `downloadBytes` is `downloadBlob`: the converter path hands the (possibly disk-backed) Blob straight to `new File([blob], …)`, so a GB-scale RVM/STEP/IFC download is never materialised in RAM at all — it used to be turned into an ArrayBuffer and immediately wrapped back into a File. The pooled GLB/TDP path still materialises, per slot, because the cooker worker takes transferable bytes. The second half of the finding (the main-thread hash pass) was already gone with 3.1 — the worker that takes the bytes hashes them. Original: `handlersAssets.ts:150-183` `downloadBytes`: chunks → `new Blob(chunks)` → `blob.arrayBuffer()` → then the
  normal import path hashes on the main thread (`assets.actions.ts:617`).
  Fix: pipe `res.body` to the cooker worker (transfer a `ReadableStream` / `MessagePort`); hash and stage per
  chunk there.

- 3.13 ~~LOW~~ **DONE** — `pack.ts` trims the index buffer with a copy and allocates per-item arrays for bounds.
  Landed: `packModel`'s sizing pass sums the exact triangle count from the descs instead of the `triByteCount` upper bound, so the index buffer is allocated at its exact (even-padded) length and returned directly — the `slice(0, …)` copy of the whole index buffer is gone from both packers. The per-item bounds are filled with a strided loop instead of a six-element JS array per item. Original: `pack.ts:295` and `:460` `indices16.slice(0, …)`; `:195` / `:334`
  `itemBounds.set([Infinity, …], i * 6)` per item. Fix: compute the exact triangle total from the descs in
  the sizing pass and allocate once; fill bounds with strided `fill()` or one loop.

- 3.14 ~~LOW~~ **DONE** — hierarchy index resolves `itemForId` (binary search) per entry in three separate passes.
  Landed: `buildIndexes` builds an `entryToItem: Int32Array` from ONE binary search per entry; the subtree walk, the item collection and both state aggregates read it instead of searching the id table again per entry per pass. `hiddenUnder` and `selectedUnder` are computed in ONE traversal (`subtreeSums` takes a list of weights) instead of two — they run on every state-version bump. Original: `hierarchyIndex.ts:36-41` `subtreeCounts` calls `itemForId` per entry; called for `itemsUnder` (120),
  `hiddenUnder` (74) and `selectedUnder` (77) — the latter two re-run on every state version bump.
  Fix: build `entryToItem: Int32Array` once in `buildIndexes`; compute hidden and selected in one pass.

- 3.15 ~~LOW~~ **DONE** — xlsx export builds the workbook as strings on the main thread, STORED (uncompressed).
  Landed: the zip writer gained DEFLATE (`zipDeflated`, platform `CompressionStream`, per-entry fallback to STORED when it does not shrink) and the xlsx writer a streaming builder: the sheet XML is encoded in 2000-row batches straight into the compressor, awaiting between batches, so a 250k-row export never builds one hundred-megabyte string and the loading dialog stays live with real progress. Not a worker — moving the rows there would structured-clone the whole grid, which is the cost the finding was trying to avoid. New unit tests inflate the output back and check it matches the stored writer byte for byte. Original: `gridExport.ts:21,39` yields once via `setTimeout(0)` then builds; `zip.ts:1,20` is STORED-only.
  Fix if it matters: build in a worker and deflate with `CompressionStream('deflate-raw')`.

- 3.16 ~~LOW~~ **DONE** — `glbRead.ts` reads every float through `DataView` (`:84-90` `getFloat32` per component) even for
  Landed: `readPositions` takes a direct `Float32Array` view when the accessor is tightly packed (stride 12) and 4-byte aligned, which is what every writer produces — one typed-array copy instead of three `DataView` reads per vertex. The strided/unaligned path is unchanged. Original: the aligned stride-12 case. Only on the TS cook path, which 3.3 argues for retiring.

---

## 4. Rendering

- 4.1 ~~MEDIUM~~ **DONE** — every MSAA scene pass resolves into `sceneColor`; only the last one needs to.
  `renderer.ts:2602-2611` — `sceneAttachments()` always sets `resolveTarget: sceneView`; it is used by the
  blend pass (2695), pass 1 (2739), pass 2 (2775) and the no-cull fallback (2788). Under default MSAA that is
  one redundant full-resolution 4-sample resolve per frame, two when a blend pass runs. Nothing between the
  passes reads `sceneColor` (the HZB reads depth).
  Fix: `sceneAttachments(clear, resolve)`; resolve only on the final scene pass.

- 4.2 ~~MEDIUM~~ **DECLINED** (2026-09-13) — all per-model cull dispatches bind the same read-write `countsBuf`, so they cannot overlap.
  Director's ruling: not wanted. No benefit is visible in practice, and both fixes are more likely to make
  things worse than better — per-model count buffers give up the single `clearBuffer` and the single stats
  copy (the count slot IS the MDI indirect-args slot), and a flat dispatch needs every model's cull / info /
  vis / record data merged into shared arenas (WebGPU has no bindless), which reaches into upload, remove,
  revive and residency. The win is bounded by the `cull 1` + `cull 2` slots and scales with model COUNT, not
  meshlet count; nothing in the raster passes moves. Not changed, not to be re-proposed. Related: 4.3 was
  downgraded to LOW on the same grounds (`cpuMs` under 4 ms).
  Original:
  `renderer.ts:2725-2733, 2762-2770` — one dispatch per live model; every one binds `draw_count`
  (`cull.ts:222`, binding 2) as a read-write view into the shared `countsBuf` at a different offset. WebGPU
  requires later dispatches in a pass to observe earlier writes, so an implementation must serialize
  dispatches that write the same storage buffer; with many zones the cull becomes that many small dependent
  dispatches per pass.
  Measure first: `cull 1` / `cull 2` timing slots vs number of live models (one big model with the same
  meshlet count as control). Cheap experiment: a per-model count buffer. Real fix: one flat dispatch over all
  models with a model-offset table.

- 4.4 ~~MEDIUM~~ **DONE** — live resize rebuilds every render target every frame, no debounce.
  `renderer.ts:2262-2283` — `sizeChanged` is evaluated per frame and calls `rebuildTargets`, which destroys
  and recreates depth, msColor, normal + id, sceneColor, hist ×2, ao ×2, the HZB chain and its bind groups
  (`rebuildTargets`, 2085+). During a dock-splitter drag this happens on every rAF, and TAA restarts each
  frame regardless.
  Fix: hold `canvas.width/height` and the targets until the CSS size has been stable for two ticks (the
  canvas is `width:100%` so it stretches meanwhile). Grow-only targets + `setViewport` is NOT a drop-in:
  `postWgsl` clamps neighbours to `textureDimensions(scene)`.
  Same block: toggling AO / edges / debug (any `usePost` / `needAo` flip) also rebuilds depth / MSAA /
  G-buffer / HZB although only hist / ao change — split `rebuildScene` vs `rebuildPost`.

- 4.5 ~~MEDIUM~~ **DECLINED** (2026-09-13, revisit if hover becomes a problem) — the outline mask replays the entire culled scene every outlined frame.
  Director's ruling: not worth breaking working code for something that may never be used and may never be
  a problem. Outline style is off by default (`selectionStyle: 'tint'`), so today the cost is zero. The full
  fix is a two-part change with real blast radius: a third emit list needs another read-write binding, so
  `mkCullBind`, both pipeline layouts and all four cull pipelines move together, plus a third count slot
  (clear size, stats copy, `drawnPerModel` readback) and regenerated `shaders.pin` snapshots; hover is NOT a
  cull flag (`fs_outline` matches `frame.ambient.y` per fragment) and the hover change lands on a hold frame
  where the cull does not run, so refreshing the list puts a dispatch + clear back onto the hold path, next
  to the TAA convergence key, `heldFrames` and the residency burst hold; and a third per-meshlet record
  buffer (20 B/meshlet) moves the per-meshlet VRAM constant the residency planner budgets from.
  Re-open only when outline hover / selection is actually in use AND the `outline` GPU timing row is a real
  share of the frame. Do the cheap variant FIRST: skip models with nothing outlined in the mask replay — a
  per-model `hasOutlined` flag computed in `writeItemStates` (it already walks the state array on every
  selection change) plus the hover id resolved to its owner via `itemBase` / `itemCount`. No shader change,
  no new buffers, no VRAM, no hold-path change, no-op when nothing is outlined. It pays in multi-model
  scenes only; a single big model still needs the real subset list.
  Noted while ruling (NOT a bug being fixed here): a selected item fully behind other geometry gets no
  outline at all today — its meshlets are occlusion-culled in cull pass 2, so the mask has nothing to
  replay, and `outlineHiddenColor` only shows where a meshlet passed the conservative HZB test but its
  fragments sit behind. A dedicated list emitted without the occlusion test would change that behaviour,
  which is a decision in its own right, not a free side effect.
  Original:
  `outlinePass.ts:229` `replayDrawLists(mask, …)` — with outline selection / hover active the mask pass
  re-runs both draw lists through `fs_outline`, which discards everything but the subset: a full extra scene
  vertex pass on each accumulation frame and on every hold frame while pulse / hover changes. Off by default
  (`selectionStyle: 'tint'`).
  Fix: emit a third per-model record list in cull pass 2 for meshlets whose item has flag 4 (the cull
  already reads `item_states_cull[...].flags`) and draw only that in the mask.

- 4.6 ~~MEDIUM~~ **DONE** (correctness of placement tools) — the depth pick reads HZB mip 0 (half-res, min over a 2×2 block) even when exact depth is available.
  `renderer.ts:2936-2950` — when culling is active, `pendingPick` copies from `this.hzb` mip 0 at
  `pick.x >> 1, pick.y >> 1`; only the no-cull path reads `this.depth`, and only when `!msaa4x`. The HZB is
  a min-reduce of reversed-Z, i.e. the FARTHEST depth in the block: at silhouettes the probe lands on the
  surface behind or on background; on slanted surfaces it is off by up to a pixel plus depth slope. This
  feeds label placement, move-to-click, Alt-pivot and Space-fly.
  Fix: use `this.depth` when not MSAA; under MSAA (the default) resolve the single cursor texel with a
  1×1-scissored fullscreen draw reading sample 0 into a tiny `r32float` target, then copy that.

### The LOW tail — declined as a batch (2026-09-13)

Director's ruling on 4.3 and 4.7-4.18 together: **not worth the risk of breaking
rendering without a bug to point at or a big gain to show.** These are
micro-optimisations — unmeasured or known-small — against a renderer that
performs, and most of them touch the parts with the least margin for error:
WGSL that `tests/shaders.pin.test.ts` pins, the cull, the HZB, the frame loop
and the target lifecycle. A wrong early-out or a mis-sized target is a visual
regression that a unit test will not catch, bought for tenths of a millisecond
nobody has measured.

They stay written down because the diagnosis is the value: if a profile ever
puts one of these passes at the top, the analysis is already done. Re-open an
individual finding only with a measurement in hand — the `cpuMs` stat and the
per-pass GPU timing rows (Stats tab) name the slot for each one. Two notes on
specific entries:

- **4.8 is safe as it stands.** The 3-wide fold on every texel is wasted work,
  never wrong: a wider min-fold of reversed-Z yields a FARTHER occluder depth,
  so the test only ever gets more conservative. No flicker risk in leaving it.
- **4.18 is the one item here that is a visible defect, not a micro-opt** —
  flooring the canvas size softens the 1 px edge lines at fractional DPR
  (125% / 150% scaling), which is the exact thing `smartPixelRatio` exists to
  prevent. It is declined with the rest because it has not been seen in
  practice; re-open it the moment edges look soft on a fractionally scaled
  display, and note the fix is in the resize path only — no shader, no GPU
  pipeline.

- 4.3 ~~LOW~~ **DECLINED** — per-model encoder calls in every pass; no render bundles. Measured: `cpuMs` stays under 4 ms.
  `renderer.ts:2647-2690` (`drawScene`), `gpuModel.ts` `replayDrawLists`: per non-hold frame per model,
  cull1 2 calls + pass1 4 + cull2 2 + pass2 4 (+ blend 8, + pick 8, + outline 8). The pass-1 / pass-2 /
  blend / pick / mask draw lists are static between model-set changes (the MDI count is read at execution
  time, so a recorded bundle stays valid across cull results).
  Measured 2026-09-13 (director, in-app stats): `cpuMs` has never been observed above 4 ms with the
  models in use, so the encoder calls are not the frame bottleneck — downgraded MEDIUM → LOW.
  Revisit only if `cpuMs` starts tracking the number of live models. Fix then: record
  `GPURenderBundle`s per (model set, pipeline variant, sample count) on upload / remove / revive;
  verify first that Chrome's bundle encoder exposes `multiDrawIndexedIndirect`.


- 4.7 ~~LOW~~ **DECLINED** — `clip_discard` / `clip_culled` loop over 8 planes + 8 shapes per fragment / per meshlet with no "clipping off" early-out.
  `scene.ts:163-187` (in `fs`, `fs_pick`, `fs_outline`) and `cull.ts:116-181` (both passes). With nothing
  enabled: 8 mask tests + 8 uniform `kind_flags.x` loads + branches per fragment. `clipPack.ts:165` writes
  only `du[32]`; `plane_mask.y` is unused padding.
  Fix: `du[33] = activeShapeCount`; `if (mask == 0u && clip.plane_mask.y == 0u) { return false; }` at the
  top of both functions (uniform branch).

- 4.8 ~~LOW~~ **DECLINED** — HZB downsample does 9 (or 6) loads for every texel when the source dimension is odd.
  `cull.ts:409-417` — `nx` / `ny` are chosen from the SOURCE parity and applied to all texels; only the last
  row / column needs the 3-wide fold. Fractional DPR or an odd canvas width is common.
  Fix: `nx = select(2u, 3u, odd_x && gid.x == dsize.x - 1u)`, same for y.

- 4.9 ~~LOW~~ **DECLINED** — HZB: one dispatch + implied barrier per mip. `renderer.ts:2749-2757` loops
  `hzbMipCount` dispatches. Cost unmeasured (watch the `hzb` timing slot). Fix: emit 2-3 mips per
  dispatch via workgroup memory, or a single-pass downsampler.

- 4.10 ~~LOW~~ **DECLINED** — cull emit: one global `atomicAdd` per visible meshlet on the per-model counter.
  `cull.ts:225` (MDI) and `:245` (VP). Cost unmeasured. Fix: workgroup aggregation (one `atomicAdd` per
  workgroup to reserve a range). Measure against the `cull 1` / `cull 2` timing slots.

- 4.11 ~~LOW~~ **DECLINED** — several small `writeBuffer`s with fresh `ArrayBuffer`s per frame; the outline pass rewrites constant params every frame.
  `renderer.ts:2487, 2489` (frame ×2), `2516` (cull params), `2566` (post), `2589` (ao);
  `outlinePass.ts:185-215` (blur H / V, glow H / V, comp + frame@768 — blur params only change with
  thickness / glow); `itemPickPass.ts:100`; `viewCubePass.ts:267`.
  Fix: outline writes blur params only on change; one "frame constants" buffer at 256-B slots filled from a
  persistent `ArrayBuffer`, one `writeBuffer`.

- 4.12 ~~LOW~~ **DECLINED** — views and bind groups recreated in the hot path.
  `renderer.ts:2602-2634` — `sceneAttachments()` / `depthAttachment()` call `createView()` on msColor,
  normalTex, idTex and depth every time they are called (2-3× per frame); `outlinePass.ts:234-252`
  `fullscreen()` creates a bind group and views per fullscreen pass, every hold frame while hovering.
  Fix: cache the views in `rebuildTargets`; cache outline bind groups per target set.

- 4.13 ~~LOW~~ **DECLINED** — `frame()` allocates and stringifies on every idle tick.
  `renderer.ts:2314-2345` — each rAF: `camera.viewProj()` (allocates), `vp.join(',')`, the ~60-segment
  template `key`, `viewCube.stateKey`; `viewport.ts:859` calls `gizmo.getRect()` every tick.
  Fix: compare 16 floats against a kept `lastVp`; replace the option string with version counters
  (`optionsVersion` bumped by `applyOptions`, `stateVersion`, `clipVersion`, a cube version); build the
  string only under `traceKey`.

- 4.14 ~~LOW~~ **DECLINED** — the G-buffer (normal + id) is attached and stored even when no post pass consumes it.
  `renderer.ts:2602-2626` attaches `normalTex` / `idTex` unconditionally; `scene.ts` always writes 3 MRTs.
  Only bites in the "plain" config (`usePost` false). Fix: `storeOp: 'discard'` on both when `!usePost`.

- 4.15 ~~LOW~~ **DECLINED** — the VS loads `item_states[info.item]` repeatedly.
  `scene.ts:361-381`: `item_opacity` reads the struct (line 75), then `.flags` at 366, 379, 381 and `.tidx`
  at 380 re-index the array. Fix: `let st = item_states[info.item];` once and pass it in.

- 4.16 ~~LOW~~ **DECLINED** (was: MEDIUM when AO is on) — VBAO runs at full resolution with `aoSlices × aoSamples` (6 × 6 default) taps per pixel per accumulation frame, then a 5×5 bilateral in post.
  `post.ts:70-76, 330-338`; defaults `viewer.state.ts:229-230`. Off by default; matches native.
  Option: half-res AO dispatch, upsampled by the existing depth-weighted bilateral.

- 4.17 ~~LOW~~ **DECLINED** — timestamp queries measure but steer nothing.
  `gpuTimings` feeds only `statsRows.ts:85` and `residency.ts:649`; `pxCut` while moving is a fixed
  setting. Fix: when timings are on and the smoothed frame total exceeds `1000/fpsLimit`, raise `pxCut`
  (or lower `aaSamples`) while moving.

- 4.18 ~~LOW~~ **DECLINED** — canvas size is floored, not matched to the device-pixel box.
  `renderer.ts:2262-2263` — `(clientWidth * dpr * captureScale) | 0`. At fractional DPR the true
  device-pixel box is only available from ResizeObserver's `devicePixelContentBoxSize`; a 1 px mismatch
  makes the compositor rescale, softening the 1 px edge lines `smartPixelRatio` exists to keep crisp.
  Fix: take the size from `devicePixelContentBoxSize` (viewport.ts already observes the host); fallback `Math.round`.

---

## 5. Transparency / blend ordering

The whole of this section is closed except three LOW items (5a.5, 5a.6, 5c.1)
and cross-model ordering, which stay in the open review. The sorted blend pass
(5b.1 + 5b.4) shipped; DESIGN.md → "Sorted blend pass" describes what runs now.

### Current state BEFORE the sorted blend pass (verified 2026-09-12)

Kept as the description of the problem the rewrite solved — it does NOT describe
the renderer as it stands.

Defaults (`viewer.state.ts`): `transparencyBlend: true` (250), `transparencyBackdrop: false` (251),
`msaa4x: true` (189), `fastAA: false` (188; renderer default also false, `renderer.ts:380`). So the shipped
default is **blend pass + MSAA, no TAA**. Alpha-hash mode without TAA is per-frame noise, so hash mode only
makes sense with TAA switched on.

Frame sequence (`renderer.ts`): cull 1 → pass 1 (opaque, depth clear) → HZB from pass-1 depth → cull 2 →
pass 2 (opaque newly-visible + helper lines + marker spheres, 2774-2782) → **blend pass** `drawBlendPass`
(2690-2712), skipped unless `transparencyBlend && hasTransparency && !sketch`.

**There is no transparent draw list.** `cull.ts` is transparency-agnostic: `emit()` (224-233) appends one
`drawIndexedIndirect` record at `atomicAdd(&draw_count, 1)` into one record buffer per (model, pass);
`cg_colors` is not bound in the cull (no reference in `cull.ts`). The blend pass **replays the same two
record lists** (`drawScene(pass, 1, true)` then `drawScene(pass, 2, true)`, 2707-2710) through the blend
pipeline. Routing happens in the **vertex shader** (`scene.ts:361-377`, VP copy 481-497): in blend mode a
meshlet whose `opacity < 1` becomes a degenerate zero triangle in the opaque passes, and every opaque
meshlet is degenerated in the blend pass. Transparent and opaque draws live in the same indirect buffer in
atomic-emission order.

Blend pipeline (`renderer.ts:1066-1104`):
- target 0: `color: src-alpha / one-minus-src-alpha` (straight alpha), `alpha: zero / one` (destination
  alpha kept — it carries the opaque surface's unlit luma for the edge pass);
- targets 1, 2 (normal G-buffer, id): `writeMask: 0` → glass writes no normals, no ids (no edges, no pick id);
- `depthWriteEnabled: !blend || backdrop` (1099), `depthCompare: 'greater'` (1100): depth-tested against
  opaque, never written;
- `cullMode: 'none'` (1094) on every scene pipeline (also 1125, 1147, 1166) — both faces drawn;
  `alphaToCoverage` is used nowhere under `src/lib/render`;
- the colour attachment is `msColor` with `resolveTarget`, so the pass resolves again at its end.

Fragment (`scene.ts:223-268`): alpha-hash discard only when blend mode is off (226-229, seeded by
`frame.flags.w`); two-sided lighting flips `n` toward the light (247); in the blend pass
`alpha = in.opacity`, `rgb = colour * shade` (265-268). Per-item alpha (`item_opacity`, 74-83): explicit
opacity override (flag bit 6) wins → else colour-override alpha (flag bit 4) → else baked `cg_colors[cg].a`.
Effective opacity 0 = hidden in both cull passes (`cull.ts:85-90`).

HiZ: in blend mode transparents write no depth, so they never enter the HZB (cannot wrongly occlude) but
ARE HZB-tested in cull 2 (`cull.ts:369`), so opaque geometry culls them. Correct. Marker spheres are
drawn in pass 2, i.e. **before** the blend pass. Backdrop mode writes depth but runs after the HZB build.

### Artifacts this produced

- 5a.1 ~~HIGH~~ **DONE** — inter-item order is view-independent. Order = model load order → per-model emission order
  (atomic slot order, roughly meshlet index = cooked spatial order) → pass-1 records before pass-2 records.
  Last-drawn wins under straight alpha, so a transparent pipe BEHIND a transparent tank draws on top wherever
  its meshlets got later slots. Cross-model: an earlier-loaded model's glass is always under a later one's.

- 5a.2 ~~HIGH~~ **DONE** — self-overlap inside one item. `cullMode: 'none'` + no depth write → a pipe or tank blends its
  far wall AND near wall in index order; effective opacity becomes 1 − (1 − α)² (0.5 → 0.75), and the
  two-sided flip lights the far wall like a front face, so internal faces show and glass reads denser than
  the slider says.

- 5a.3 ~~MEDIUM~~ **DONE** — one-frame pop. A meshlet newly visible in frame N sits in `recordBuf2` (drawn last); in
  N+1 it moves into `recordBuf1` order, so the overlap colour changes the frame after it appears or after
  any occlusion flip (2707-2710).

- 5a.4 ~~MEDIUM~~ **DONE** — cost. The blend pass replays the ENTIRE visible draw list: every visible meshlet runs the
  vertex shader twice whenever any transparency exists (opaque ones degenerate, so no raster, but full
  vertex fetch + transform + item-state reads).

### Options (decided — 5b.1 then 5b.4)

The option survey that led to the rewrite, with the closing status note.

Shared facts: the cull already has `params.view` and `params.eye` (`cull.ts:26-27`) and computes the
view-space sphere centre in `occlusion_visible`; item flags / colour are bound but `cg_colors` is not
(baked alpha needs one new binding). Anything per-frame must be done identically in cull 1 and cull 2.

- 5b.1 **(a)** GPU sort in the cull: dedicated transparent list + depth-bucket (counting) sort — RECOMMENDED phase 1. Size M.
  `emit()` evaluates `item_opacity` (bind `cg_colors`); opaque → existing records; transparent → append
  `(meshlet, key)` to a per-model candidate list and `atomicAdd` a K-bucket histogram (K ≈ 1024, key = view
  depth of the sphere centre, log-mapped; bucket 0 = farthest). After cull 2: one prefix-scan dispatch +
  one scatter dispatch that writes the 5-word records into a third record buffer `recordBufT` at
  `base[b] + atomicAdd(cursor[b])`. Blend pass = one `multiDrawIndexedIndirect` of `recordBufT` per
  model, back-to-front by bucket. Opaque passes then draw opaque-only records → the VS routing and the
  full-scene replay go away. VP path: the same over `vis_list`. `freezeCull` / hold keep `recordBufT`
  like `recordBuf1/2`.
  GPU cost: one extra storage read per culled meshlet; scan / scatter is O(transparent meshlets). Net
  cheaper than today's full replay. Memory: 28 B per transparent meshlet.
  Fit: MDI-native, HiZ unchanged, MSAA unchanged. TAA: the order only changes when the camera moves, which
  already resets accumulation (`renderer.ts:2402`). Camera-relative: the cull runs in absolute space and
  only needs bucket precision.
  Fixes the inter-item order, the one-frame pop and the replay cost; cross-model order is per model
  unless draws go bucket-major (follow-up). Self-overlap is NOT fixed → pair with 5b.4.

- 5b.2 **(b)** CPU per-item sort — NOT recommended. The list is GPU-produced; the CPU cannot reorder MDI
  records without a readback. The workable variant ("CPU rank per item on camera change, cull scatters by
  rank") needs the same GPU machinery as 5b.1 with a worse key (a long pipe run's centre depth is
  meaningless) plus a CPU pass + upload per camera move.

- 5b.3 **(c)** Back-faces then front-faces via `cullMode: 'front'` / `'back'` — broken on this data.
  Nothing in the cook / convert path enforces winding: `rvm-core/src/instancing.rs:143-146` hashes
  explicitly ignoring winding, every scene pipeline is `cullMode: 'none'` with two-sided lighting, and the
  view cube deliberately avoids winding culling (`viewCubePass.ts:84-86`). Mixed winding would drop random faces.

- 5b.4 **(c')** Winding-free front/back split — RECOMMENDED phase 2, size S on top of (a).
  Facing from geometry, not winding: orient the flat normal outward from the meshlet centre
  (`dot(flat_n, world − centre) > 0`), then `front = dot(n_out, eye − world) > 0`. Draw the sorted
  transparent list twice: pass A discards front faces, pass B discards back faces (a flag bit in a new
  frame slot). Meshlet centres lie inside tubes / vessels / box-like parts, which is exactly where
  self-overlap hurts; thin plates get arbitrary facing but have no self-overlap. Cost 2× transparent
  VS + FS (the FS discards half). A cheaper "front-only" toggle (single draw) removes the darkening and
  internal faces at the price of the far wall — fine for "ghost to see inside". Needs the meshlet centre in
  the render bind (from `meshlet_info` aabb / scale; check the cooker's u16 range when placing it).

- 5b.5 **(d)** Weighted-blended OIT (McGuire-Bavoil) — the alternative if "never pops" matters more than "physically ordered". Size M.
  Blend pipelines stop touching the scene target; write `accum` (rgba16f, one / one) = w·(α·rgb, α) and
  `reveal` (r16f, dst · (1 − α)); composite in `post.ts` before edges / TAA. Order-independent, no cull
  changes, HiZ untouched, TAA fine (composited before accumulation). Post can then choose whether opaque
  edges go over or under the glass. Pitfalls: with 4× MSAA the two extra targets cost
  width × height × 4 × 10 B (1920×1080 → ~83 MB, 4K → ~330 MB); running the WBOIT pass single-sampled
  against a sample-0 depth copy cuts that 4× at the cost of aliased glass edges unless TAA is on. The
  weight function must span 10 m to 10 km scenes (use view depth). Look: two glass items at similar depth
  mix ~50/50 regardless of order. Self-overlap still averages both walls → pair with 5b.4.

- 5b.6 **(e)** Depth peeling (2-4 layers) — N replays of the transparent list against a ping-pong "previous
  layer" depth; under MSAA either sample-0 mismatches at edges or 4× FS via `sample_index`. N× transparent
  VS + FS, which is N× the scene when the whole model is ghosted. Size M-L. Not recommended for this use case.

- 5b.7 **(f)** Per-pixel linked list / A-buffer — head buffer (atomicExchange) + node pool (atomicAdd), resolve
  sorts ≤K per pixel. Exact. Memory pixels × layers × 12 B (2560×1440 × 8 layers ≈ 350 MB) plus overflow
  handling; per-pixel only under MSAA. Size L; conflicts with the VRAM budget work. Only as an optional
  "quality snapshot" mode.

- 5b.8 **(g)** Hybrid — already two-thirds present: passes 1 + 2 ARE the opaque depth prepass, and the blend
  pass is depth-tested-not-written. The missing parts are exactly 5b.1 + 5b.4.

**Recommendation:** 5b.1 then 5b.4. Deterministic, MDI-native, removes the full-scene replay (net perf
win), and with the front/back split gives correct results for pipes, tanks and vessels. Choose 5b.5 instead
only if smooth many-layer ghosting without popping is valued over physically ordered layers; 5b.5 and 5b.4
combine. Skip 5b.2, 5b.6, 5b.7.

**Status (2026-09-12):** 5b.1 + 5b.4 landed on both MDI and vertex-pull (DESIGN.md "Sorted blend pass").
Deviations from the sketch above: the facing split draws each meshlet's two halves ADJACENT (two instances
per record / two list entries) instead of the whole list twice, so wall patches with an arbitrary centre
never interleave with other meshlets; 2048 buckets; the meshlet centre comes from the AABB already in the
render bind (no cook change). Fixes 5a.1, 5a.2, 5a.3, 5a.4. Left open: 5a.7 (cross-model order); 5a.5, 5a.6 declined below, 5c.2 closed by 4.1.

### Other observations

- 5c.2 ~~LOW~~ **DONE** — closed by 4.1 (resolve only on the last scene pass): the blend pass, when it
  runs, is that last pass, so a transparent frame now resolves once instead of three times.
  Original: the blend pass adds a third `msColor → sceneColor` resolve per frame (see 4.1).
  Option 5b.1 removes the replay but not this resolve; only the resolve-on-last-pass fix does.


- 5a.7 ~~MEDIUM~~ **DECLINED** (2026-09-15, measured — re-open only with a user complaint on a real scene)
  — cross-model ordering: the depth sort is per model, so glass in an earlier-loaded model sits under glass
  in a later one wherever the two overlap.
  Director's ruling: written off as too expensive for what it buys. The finding was costed the same day it
  was numbered, and then a measurement settled it (see 5a.8): on a transparency-heavy scene the blend pass
  is already 44 of 50 ms, so the only EXACT fix — G filtered passes over the transparent list — multiplies
  the most expensive pass in the frame. What is left is the free model-bounds sort, which does not fix the
  case most likely to be hit deliberately (the same model loaded twice for a revision compare has identical
  bounds), so it buys correctness in the easy case only. The artifact is narrow to begin with: it needs two
  models' TRANSPARENT geometry overlapping on screen — glass behind an opaque surface is occluded correctly
  whatever the model order, because blend mode routes transparent items out of the depth-writing opaque
  passes. Re-open if a user points at it on a real model, and then take the free model-bounds sort first.
  Original:
  sits under glass in a later one wherever the two overlap, whatever the camera says.
  The sorted blend pass fixed ordering INSIDE a model: `renderer.ts:2965-2984` runs the bucket scan and
  the scatter once per model (`for (const m of this.models)`), each writing its own `recordBufT` from its
  own histogram, and `drawScene` (`renderer.ts:2827-2832`) then draws those lists model by model. So the
  back-to-front guarantee stops at the model boundary and the models themselves are ordered by load, not
  by depth — the pre-rewrite 5a.1 artifact, surviving one level up.
  Only visible where two models' transparent geometry overlaps on screen (a glass facade loaded over a
  plant model, a scan loaded next to CAD), which is why it was not worth blocking the rewrite on.
  Only transparent-over-transparent is affected: blend mode routes transparent items out of the opaque
  passes, which write depth first, so glass behind an opaque surface is still occluded correctly whatever
  the model order. The keys are already globally comparable — `sort_bucket` (2048 log buckets) is keyed off
  the scene-bounds far corner, shared by every model — so only the SUBMISSION is per model.
  Fix directions, costed 2026-09-15:
  (1) **Order models back-to-front by scene bounds in the blend pass only.** Free: an N-model sort per
  frame, no GPU work, no VRAM, no shader change. Fixes separated models (a facade loaded next to a plant);
  does nothing where bounds interleave, which includes the same model loaded twice for a revision compare.
  Effort S.
  (2) **One shared record buffer / global histogram — NOT possible as stated.** Each model owns its
  `vertexBuf` / `indexBuf` / `renderBind` (`renderer.ts:2836-2846`), so a globally sorted list cannot be one
  MDI call: a depth-interleaved list would need a rebind per meshlet run. It requires shared geometry
  buffers across models, which fights per-model load / unload and residency. Dead unless the geometry
  allocator is rewritten.
  (2') **Bucket-group interleave** (draw far→near in G groups, models inner). MDI blocks it:
  `multiDrawIndexedIndirect` takes a CPU-side byte offset while the bucket bases are GPU-computed by the
  scan, so CPU-known offsets mean a fixed G-way partition of `recordBufT` — 20 B of the 144 B fixed
  per-meshlet VRAM, so G=8 takes 144 → 284 B per meshlet. Dead against the VRAM budget. The vertex-pull
  path could do it (its draw args are GPU-written), but correctness only in the non-MDI fallback is
  backwards.
  (3) **G filtered passes over the full list** — the real candidate. Draw the blend pass once per group,
  VS collapses records outside the group to degenerate triangles. No VRAM change (or +4 B/meshlet to store
  the bucket instead of recomputing it), no layout change; cost is G× index + VS work on the transparent
  subset only, fragments and blending unchanged, plus G×M draw calls. Ordering is exact within a model
  (2048 buckets) and G-granular across models. Effort M.
  (4) Accept and document.
  Measure before building: the `sort` and `blend` timestamp spans already exist (`gpuTimings.ts`, Stats
  tab) — (3)'s multiplier applies to the vertex-side half of `blend`, so the decision needs that number on
  a glass-heavy model, not an estimate.

---

- 5a.8 ~~MEDIUM~~ **DECLINED on arrival** (2026-09-15, measured — re-open if the free levers are not enough)
  — the blend pass has no adaptive fallback: its cost scales with the WHOLE transparent set, not with a
  transparent minority, and nothing detects when the assumption behind the sorted blend pass stops holding.
  Measured on a 136-model, 788,224-meshlet scene (RDNA-3), from the Stats tab:
  `drawn p1 / p2 / blend = 635 / 3 / 159,448` — 99.6 % of the drawn meshlets go through the blend pass —
  `blend 44.23 ms` of a `total 50.26 ms` frame at 19 fps, `cpu 0.94 ms` (GPU-bound), `sort 2.03 ms`,
  `scene 1 0.24 ms`, `scene 2 0.00 ms`.
  Diagnosis: the pass is vertex-bound on padding, not fill-bound on blending. The measurement was taken on
  the VERTEX-PULL fallback (`culling: vertex-pull` — the adapter had no
  `chromium-experimental-multi-draw-indirect`, `renderer.ts:853`), where every meshlet draws a flat 372
  vertices whatever its real index count (`cull.ts:495`, `scene.ts:471`; padding vertices clamp to the last
  index and die pre-raster, but the invocation and its storage loads still happen), and the transparent list
  holds two entries per meshlet for the winding-free facing split — so 159,448 × 2 × 372 ≈ 118.6 M vertex
  invocations against scene 1's 635 × 372 ≈ 236 K in 0.24 ms. The scene averages 55.7 M tris / 788,224
  meshlets ≈ 71 tris ≈ 212 indices per meshlet against that flat 372.
  Director's ruling: written off as too expensive. Two free levers already cover the case and neither is
  code: (1) the MDI path writes each meshlet's real `index_count` instead of 372, so running Chrome with the
  multi-draw flags removes the padding waste outright — the 44 ms above is a fallback-path upper bound;
  (2) `transparencyBlend: false` (hash / dithered transparency) puts transparent items back in the opaque
  pass with depth write, one draw per meshlet, no sort and no facing split — the right mode for a scene that
  is ghosted wholesale, which is what a 99.6 % transparent share means.
  What was NOT built, and is the thing being declined: an adaptive switch (or a warning) when the
  transparent share crosses a threshold, plus anything that makes exact sorted blending cheap at that scale.
  Re-open if a user hits this with the flags ON and hash mode rejected on looks — then the measurement to
  take first is MDI-path `blend` on the same scene, to separate the padding waste from the overdraw.

### The LOW tail — declined as a batch (2026-09-15)

Same grounds as the section-4 tail: the cost is real, the cure is worth more
than the symptom only once someone complains about the image, and each has a
named re-open condition. 5a.7 (cross-model ordering) stays open in
`REVIEW_20260912.md` — it is the one artifact of the group that a user can
actually point at.

- 5a.5 ~~LOW~~ **DECLINED** — edges / AO are computed from the opaque surface behind the glass (G-buffer
  masked) and composited over the blended colour at full strength; glass itself gets no edges. Native
  parity, but reads as "the glass is behind the lines". Declined because it IS native parity: the reference
  renderer looks the same, and changing it means deciding what an edge on transparent geometry should even
  mean (its own silhouette? the surface behind, attenuated?). Re-open if glass-heavy models become a
  primary use case, and then as a deliberate look, not a bug fix — attenuating the composite by the blended
  alpha is the cheap first experiment.
- 5a.6 ~~LOW~~ **DECLINED** — glass blends over translucent marker spheres (pass order). The markers are
  overlay geometry drawn before the blend pass, so glass in front of a marker still paints over it. Declined
  as cosmetic and self-limiting: markers are small, and the alternative (markers inside the sorted list, or
  a third pass after it) costs more than the artifact. Re-open if measurement markers are ever used THROUGH
  glass as a workflow rather than incidentally.
- 5c.1 ~~LOW~~ **DECLINED** — hash mode under MSAA gains nothing from the extra samples.
  `alpha_hash(vec2u(in.clip.xy), …)` (`scene.ts:228`) is per pixel and the FS runs per pixel, so all 4
  samples share the discard. Declined by its own diagnosis: it is not a bug, and per-sample hashing means
  per-sample shading — a 4× fragment cost for dithered transparency that is already the cheap mode.
  Re-open only if hash mode becomes the default over the sorted blend pass.

---

## 6. Client (postMessage) API

- 6.1 ~~HIGH~~ **BY DESIGN** (2026-09-12) — no per-client capability scoping: every allowed origin gets the full command table.
  Ruling: panels and host are both full-trust on purpose. An origin enters the allowlist only when the user adds
  an app in Settings or an already-allowed origin calls `externalApps.set`, so the grant IS the configuration
  step (like installing an extension) and there is nothing for a panel to escalate to. Per-client scoping would
  be a feature (opt-in restricted apps), not a fix; parked until a real untrusted-panel use case shows up.
  EVENTS.md now states this trust model explicitly. Original finding kept below for the record.
  `transport.ts` `allowedOriginCandidates()` includes `externalAppOrigins()` (every configured or host-set
  external app); `index.ts` `dispatch(type, p, bytes, source)` looks up `handlers[type]` with no notion of
  who asks. So an external-app panel (any URL typed into Settings or pushed via `externalApps.set`) can run
  `sql.execute`, `sql.delete`, `assets.remove`, `settings.*.set` (persisted), `externalApps.set`,
  `console.clear`, and put text into viewer chrome via `ui.confirm / error / loading`. It also receives
  every app event (6.2), including the full `instance.changed` blob.
  Proposal: derive a `scope` on `ClientEntry` from `kindOf()` — parent / opener = full, panel = a
  `PANEL_COMMANDS` allow-set (ui.close / dialog.*, instance.*, custom.*, selection / nav / labels /
  measurements, read-only sql.query) unless the app entry opts in (`api: 'full'`); new error code
  `forbidden`. Effort M.

- 6.2 ~~MEDIUM~~ **DONE** — app events are a firehose: no subscription, cloned targets × origins times, DOM query per emit.
  `transport.ts:86-116` `emitApiEvent`: every emit runs `document.querySelectorAll('iframe')`, then posts
  the message once per allowed origin per target (nested `for` at 111-114). `postMessage` serializes at
  call time, so a progress tick or instance blob is cloned `origins × targets` times; `sql.*:progress`
  row ticks (`handlersSql.ts:194`) and download ticks reach every window regardless of interest. Only the
  custom bus has an `events` filter. (Also surfaced by the section 1 review.)
  Proposal: route app events through the client registry — each entry holds its exact origin and `post()`
  (`clients.ts:136-140`) posts once correctly. Add an `events.subscribe` command (the SDK calls it lazily
  on first `on(type)`); keep the parent / opener broadcast as legacy fallback. Effort M.

- 6.3 ~~MEDIUM~~ **DONE** — no command discovery; an unknown command is indistinguishable from a bad payload.
  `index.ts` `dispatch` throws `bad-payload` for an unknown command; `app.ready` carries only
  `{ version, api: PROTOCOL }` with `PROTOCOL = 1` (`transport.ts:137`, `protocol.ts:5`), never bumped
  when commands are added. Hosts across viewer versions cannot feature-detect.
  Proposal: `unknown-command` code + `app.info` returning `{ version, api, commands: Object.keys(handlers), events }`;
  SDK `client.supports('x.y')` cached from ready. Effort S.

- 6.4 ~~MEDIUM~~ **DONE** — no cancellation of long commands.
  Landed: an id-less `command.cancel` note carrying the command's id. `dispatch` keeps an `AbortController` per in-flight (client, id) and hands the signal to the handlers; `answerCommand` reports `cancelled` rather than a result nobody is waiting for. The SDK's `send` takes a `signal`, and — the part that mattered — its TIMEOUT now posts the cancel note too, instead of only dropping the pending entry while the viewer kept working. A client that says `client.bye` or unloads cancels everything it started. What actually stops: `assets.importUrl` and `sql.importUrl` abort their fetches and start no more files, `viewpoints.setUrl` aborts its fetch, `sql.execute` refuses to start. A statement already inside the SQLite worker or a synchronous wasm call still runs to completion — killing the worker would abort every tab's query — but answers `cancelled`. Documented in EVENTS.md under "Ordering and cancellation". Original: SDK timeouts (`tredespace-client.ts:3077-3082`) only delete the pending entry; the viewer keeps
  downloading / cooking / querying and posts a result nobody reads. No `AbortSignal` on any method; the
  only abort is `assets.uploadAbort` (`handlersAssets.ts:590`). `assets.importUrl`, `sql.importUrl`,
  `sql.execute` have no abort path.
  Proposal: optional `signal` in `send()` posting an id-less `{ type: 'cancel', payload: { id } }`;
  `dispatch` keeps an `AbortController` per in-flight id and passes `signal` to handlers
  (`fetch(url, { signal })`, the cooker pool). Effort M.

- 6.5 ~~MEDIUM~~ **DONE** — trust-by-shape payloads contradict EVENTS.md:68 ("Every payload is validated").
  Landed: `protocol.ts` gained `num` / `numOpt` / `str` / `strOpt` / `boolOpt` / `vec3` / `vec3Opt` / `quat` / `quatOpt` / `oneOf`, and the three trust-by-shape sites use them: `clip.shapes.add` validates every field of every shape (which also removed its `as` cast), `measurements.set/add` validates kind, every point triple and every flag, and `instance.set` goes through the same JSON round-trip + 1 MB cap `custom.post` takes — it is rebroadcast to every window on each change, so an unbounded blob there was an unbounded blob times every client. Original: `handlersViewer.ts:219-221` `clip.shapes.add`: `records(p.shapes, 'shapes') as Parameters<typeof addShapes>[0]`;
  `clipShapes.actions.ts:268-290` checks only that `kind` is a string and casts it, so `center: 'x'`,
  `radius: '5'`, `rotation: [1]`, `kind: 'blob'` land in state and become NaN in the clip uniforms.
  `handlersScene.ts:58-70` `measurements.set/add` passes raw records through `JSON.stringify` →
  `importJson`, which checks only `kind` / `points` array-ness (`measurements.actions.ts:327`).
  `handlersUi.ts:247-255` `instance.set` checks `isRecord` only — no size cap (custom.post has 1 MB,
  `customPayload.ts:14`) — and rebroadcasts to every window on each change.
  Proposal: small validators in `protocol.ts` (`vec3`, `quat`, `num(min,max)`, `str(max)`), applied to
  shapes / measurements / instance (cap 1 MB) → `bad-payload`. Effort S-M.

- 6.6 ~~MEDIUM~~ **DONE** — the docs describe behaviour the code does not have, and nothing checks accuracy.
  `scripts/gen-api-docs.mjs` fails the build only for UNDOCUMENTED commands (presence; lines 408-413);
  only settings have compile-time parity (`SDK_TAB_PARITY`, `handlersSettings.ts:36`). Drift found:
  `EVENTS.md:2199` ("Implementation notes") claims a ~2 GB size guard on `assets.import` — no size check
  exists in `handlersAssets.ts` or `assets.actions.ts`. `EVENTS.md:627` and the SDK send `offset` on
  `uploadChunk`; the handler appends sequentially and never reads it (`handlersAssets.ts:540`).
  `EVENTS.md:60-61` says replies are "never `*`", but `index.ts:172` and `clients.ts:140` post with `'*'`
  for `null`-origin senders.
  Proposal: type handlers as `ApiHandler<Payload, Response>` importing the SDK interfaces (the app already
  does this for settings) so tsc enforces response shapes; a vitest asserting set-equality of EVENTS.md
  `### command` names, `Object.keys(handlers)` and the SDK's `send('…')` strings; fix the three doc lines.
  Effort M.

- 6.7 ~~MEDIUM~~ **DONE** — zero protocol test coverage.
  `tests/` covers only pure helpers (customPayload, dialogEvents, settingsPatch, sqlEditorPayload);
  `scripts/boot-test.mjs` never touches the API; `vitest.config.ts` has no `@treDeSpaceUI` alias so
  `index.ts` cannot be imported. Minimal contract test: (a) SDK round-trip in jsdom with a fake target
  `{ postMessage(msg, origin, transfer) }` echoing synthetic `MessageEvent`s — id correlation, timeout,
  ready before / after hello, `app.bye`, relay forwarding, transferable detachment; (b) extract
  `handleEnvelope(data, origin, source, deps) → reply | null` from `index.ts` into a pure module and test
  origin rejection, envelope checks, `not-ready`, `ApiError` → code, non-`ApiError` → `internal`;
  (c) the parity test from 6.6. Effort M.

- 6.8 ~~MEDIUM~~ **DONE** — SDK ergonomics gaps.
  `on(type: string, handler: (payload: unknown) => void)` (`tredespace-client.ts:2844`) — no `EventMap`,
  a typo is silent; no `once()` / `waitFor()` (no occurrences in the file). `ready()` (1620-1624) never
  times out or rejects; `markApiReady` runs at the end of the successful startup path
  (`useAppStartup.ts:154`) and there is no `app.error` event, so a viewer that fails WebGPU init hangs
  `await ready()` forever. `send()` (3063) does not await ready — early calls get `not-ready` instead of
  being queued. Naming: `colorApplyList` ↔ `colorRules.applyList` (the only method not mirroring its
  command); `colorRulesResetModel` duplicates `modelReset({color, opacity, hidden})`; `assetsRemove` vs
  `sqlDelete`; `uiKiosk(on?)` / `uiTheme(theme?)` get-or-set vs `camera.get / set`.
  Proposal: typed `EventMap`, `once`, `ready({ timeoutMs })`, an `app.error` event, opt-out auto-await of
  ready in `send`, deprecate the aliases. Effort S.

- 6.9 ~~MEDIUM~~ **BY DESIGN** (2026-09-15) — capabilities the state layer has that the API does not expose.
  Director's ruling: the client API is supposed to do a lot, but not to replace the user. A host embeds the
  viewer and drives it; the person in front of it still selects, hides, exports and undoes, and a command
  exists because a host asked for it — not to make the wire surface mirror `src/state/**`. Events are the
  same: added when a need shows up, one at a time. So the list below is not a defect list, it is the menu
  to pick from when that need arrives. If it is ever worked through, the missing halves of symmetric pairs
  (`measurements.get`, `clip.shapes.get / update / remove`, `stores.remove`, `viewpoints.activate`) are the
  cheapest and the most surprising by their absence; `undo / redo` is NOT the S the finding claims — there
  are three undo domains (colour / opacity / visibility in `colorUndo.ts`, labels in `labels.actions.ts`,
  transforms) and exposing one verb means first deciding what a host undoes.
  Two corrections to the original, found while ruling on it: `app.error` already exists — it is in the SDK
  event map, in EVENTS.md, and emitted for `gpu-init` / `gpu-lost` / `gpu-recovery`; what is missing is
  coverage (import, cook and SQL failures never raise it). `gpu.lost` is therefore half-covered too: the
  loss is emitted, the RECOVERED edge is not, and the confirm dialog remains invisible to the host because
  `dialog.changed` fires from the external-modal / external-panel stores only. Command count is 101 today,
  not the 99 counted then.
  Original: capabilities the state layer has that the API does not expose (99 commands registered; verified by absence from the handler tables).
  Events: `selection.changed` for any route (only click-driven `tree.select` exists); `model.loaded /
  unloaded`; `gpu.lost / recovered` (`gpuRecovery.ts` shows a confirm the host cannot see); `app.error`;
  a throttled `camera.changed`.
  Commands: `measurements.get` (labels.get exists, measurements.get does not); `labels.remove` /
  `measurements.remove` by id; `clip.shapes.get / update / remove` (only `add`), `clip.box.set`, clipping
  planes; `viewpoints.activate / list / remove` (only get / set / setUrl / addFromLabels /
  setBookmarkButton); `stores.remove` (only create / list); `selection.hide / isolate / invert /
  unhideAll / setColor / setOpacity` (`viewer.actions.ts:736-868`); `undo / redo`; `export.glb / tdp / ifc`
  (`export.actions.ts:120-262`); state `snapshot.save / load`; `layouts.activate`; `stats.get` for fps /
  VRAM / residency (only `gpu.info.get` exists); hotkeys. Effort S each.

- 6.10 ~~LOW~~ **DONE** — error codes misreport the cause.
  Landed: three separate fixes. `busy` is now reserved for the import LOCK: the import actions report whether they actually ran, so an import that ran and produced nothing answers `internal` with a pointer to the Console instead of sending hosts into a retry loop over a file that will never import. Two new codes carry the caller errors that used to look like viewer bugs: `download` (`viewpoints.setUrl`) and `sql` (everything SQLite rejects — `sql.execute`, `sql.table`, the colouring queries). Both are in the SDK's union and in EVENTS.md. Original: `handlersAssets.ts:82-84` reports ANY import that produced no entries as `busy` ("busy or failed");
  `viewpoints.setUrl` download failures and sqlite errors such as "no such table" surface as `internal`
  although they are caller errors. Proposal: have `importSources` return a Result the handler maps; reserve
  `busy` for lock failures; add `download` and `sql` codes. Effort S.

- 6.11 ~~LOW~~ **DONE** — per-asset worker round-trips on the main thread.
  Landed: `db.hasModels(keys) -> boolean[]` — one worker round trip with a set built once. `assets.list` and `assets.setLoaded` use it instead of awaiting a `hasModel` per asset. Original: `assets.list` (`handlersAssets.ts:458`) and `assets.setLoaded` (695) `await db.hasModel()` inside a
  loop; `apiModels.ts:450` has no batch form. Proposal: `db.hasModels(list) → boolean[]`. Effort S.

- 6.12 ~~LOW~~ **DONE** — `view.screenshot` ships base64 in a string.
  Landed: the PNG comes back as raw bytes, TRANSFERRED. Replies can now carry a transfer list (`withTransfer` keeps it in a WeakMap beside the payload, so nothing extra reaches the wire), and `view.screenshot` returns `{ bytes, mime, width, height }`. Transfer works to a cross-origin window — it is part of postMessage, not origin-gated — and a transfer that the host's engine refuses falls back to posting a copy rather than losing the reply. `{ dataUrl: true }` keeps the old base64 string for a host that wants an `<img>` src. Original: `handlersViewer.ts:181-191` — a Blob is captured, then converted to a `dataUrl` string. Proposal:
  return the `Blob` (cloned by reference) or a transferable `ArrayBuffer` in `bytes`; keep `dataUrl` behind
  an option. Effort S.

- 6.13 ~~LOW~~ **DONE** — commands run concurrently with no ordering guarantee.
  Landed: a per-client FIFO. Commands from ONE window run in arrival order, so `selection.set` then `view.screenshot` without awaiting gives a screenshot WITH the selection; different clients stay concurrent. `parallel: true` in a payload skips the queue — the escape hatch for a read a host wants answered while a long import runs. Documented rather than left to luck. Original: `index.ts:62` `window.addEventListener('message', (e) => void onMessage(e))`; each message dispatches
  independently, so a fast command from one host can complete before a slower earlier one. Only imports are
  serialised (import lock). Proposal: per-client FIFO for mutating commands, or document "await each call".
  Effort S (document) / M (queue).

- 6.14 ~~LOW~~ **DONE** — registry cleanup is lazy and walks the DOM.
  Landed: `dropClientsForDialog(id)`, called from `externalPanelsActions.close` and the modal's `removeExternalModal`. A removed iframe never sets `Window.closed`, so the lazy prune could never catch one — its entry, a strong `Window` reference with its event subscription, lived as long as the tab. Original: `clients.ts:77` `prune()` is called only from bus functions (126, 149, 195); an iframe removed without
  `client.bye` stays in `entries` (strong `Window` ref) until someone lists clients. `emitApiEvent` and
  `panelIdOfWindow` (`clients.ts:45-49`) walk all iframes per call. Proposal: prune from
  `externalPanelsActions.close` / modal close, and in emit. Effort S.

- 6.15 ~~LOW~~ **BY DESIGN** (2026-09-15, revisit if the viewer is ever hosted multi-tenant) — `*Url`
  commands call `fetch(url)` with default options.
  Director's ruling: the viewer is meant to be SELF-HOSTED, so a page served from the same origin as its
  data is the normal deployment and some of those hosts will want their session cookie to ride along.
  `credentials: 'omit'` would break exactly the setup we suggest — an authenticated intranet endpoint
  feeding `sql.importUrl` / `assets.importUrl` / `viewpoints.setUrl` without the host proxying every byte
  through postMessage. The intranet-URL half follows 6.1's trust model: an allowlisted origin is full-trust
  by design, and one that can already run `sql.execute` and read the model gains nothing by naming a URL.
  Re-open if a shared multi-tenant deployment appears, where being on the allowlist no longer implies
  trust — then credentials become opt-in per app entry rather than omitted for everyone.
  Original: `handlersScene.ts:182`, `handlersAssets.ts:152`, `sqlAssets.actions.ts:303` — same-origin
  cookies ride along on same-origin URLs, and any allowed origin can point the viewer at intranet URLs.
  Consider `credentials: 'omit'` and http(s)-only. Effort S.
