// Guide scene: F12 Assets (f12-assets.html) — the asset workspace: Model
// Assets, SQL Assets, Import Manager and Export. The RVM import is driven
// through the real panel (files handed to its hidden file input, the way the
// picker would), so the pictures show the panel mid- and post-import.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { choose, fitView, layout, PANEL_W, stack } from './_lib.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const RVM_DIR = resolve(ROOT, 'convertSamples/rvm');

/** The disciplines imported in the walkthrough (HA-INST left out: a stray part
 *  near the origin makes a fit-to-view frame the plant as a speck). The big
 *  structural file goes first so the progress shot catches the convert phase. */
const RVM_FILES = ['HA-STRU', 'HA-PIPE', 'HA-MECH', 'HA-HVAC', 'HA-SAFE'];
const TEMP_RVM = 'HA-TELE';
const STORE = 'Huldra';
const STORE_NOTE = 'Huldra platform — open sample data';

const IFC_SAMPLE = resolve(ROOT, 'convertSamples/ifc/wall-with-opening-and-window.ifc');
const STEP_SAMPLE = resolve(ROOT, 'rust_src/crates/step-core/tests/fixtures/as1_pe_203.stp');
const GLB_SAMPLE = resolve(ROOT, 'samples/HuldraDemo.glb');

const MA = { panel: 'modelAssets' };
const IM = { panel: 'importManager' };
const SQ = { panel: 'sqlAssets' };
const EX = { panel: 'export' };

const IMPORT_TIMEOUT_MS = 170000;

/** SQL Assets' toolbar row needs a bit more than PANEL_W to fit. */
const SQL_PANEL_W = 470;

// -----------------------------------------------------------------------------
// local helpers
// -----------------------------------------------------------------------------

/** A small generic SQLite database to show in SQL Assets (written fresh to the OS temp dir each run). */
function makeSampleDb() {
  const dir = resolve(tmpdir(), 'tredespace-docshots-f12');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'plant-data.db');
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE items (fullname TEXT PRIMARY KEY, discipline TEXT, status TEXT)');
  const ins = db.prepare('INSERT INTO items VALUES (?, ?, ?)');
  for (const [name, disc, status] of [
    ['/HA-PIPE', 'Piping', 'Installed'],
    ['/HA-MECH', 'Mechanical', 'Installed'],
    ['/HA-SAFE', 'Safety', 'Planned'],
    ['/HA-HVAC', 'HVAC', 'Installed'],
  ]) {
    ins.run(name, disc, status);
  }
  db.close();
  return path;
}

/** Wait until no import holds the import lock and the progress overlay is gone. */
async function waitImportIdle(ctx) {
  await ctx.eval(async (limit) => {
    const { dialogsState } = await import('/src/components/dialogs/dialogs.state.ts');
    const t0 = Date.now();
    for (;;) {
      const q = await navigator.locks.query();
      const busy = [...(q.held ?? []), ...(q.pending ?? [])].some((l) => l.name === 'asset-import');
      if (!busy && !dialogsState.get().loading) {
        return;
      }
      if (Date.now() - t0 > limit) {
        throw new Error('docs-shots: import did not finish');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }, IMPORT_TIMEOUT_MS);
  await ctx.sleep(500);
}

/** Wait (up to 20 s) for the progress overlay to appear. */
async function waitDialog(ctx) {
  await ctx.page.waitForSelector('[role="dialog"]', { timeout: 20000 });
}

/** Hand files to an Import Manager section's hidden file input — what the
 *  "Select … file…" picker does after the user picks. */
async function stage(ctx, section, paths) {
  await ctx.section('importManager', section, true);
  const input = await ctx.handle({ ...IM, section, css: 'input[type="file"]' });
  await input.uploadFile(...paths);
  await ctx.sleep(500);
}

/** Drag the splitter on the RIGHT edge of panel `id`'s stack so the stack is
 *  `width` px wide. The runner's ctx.widen drags the left splitter, but the
 *  asset column's left neighbour (Hierarchy) is already at its minimum. */
async function widenRight(ctx, id, width) {
  const at = await ctx.eval((i) => {
    const r = document.querySelector(`.dock-panel[data-panel="${i}"]`)?.closest('section.dock-tabs')?.getBoundingClientRect();
    if (!r) {
      return null;
    }
    for (const sp of document.querySelectorAll('.dock-splitter')) {
      const b = sp.getBoundingClientRect();
      if (b.height > b.width && Math.abs(b.left - r.right) < 8 && b.top <= r.top + 1 && b.bottom >= r.bottom - 1) {
        return { x: b.left + b.width / 2, y: r.top + r.height / 2, w: r.width };
      }
    }
    return null;
  }, id);
  if (!at) {
    throw new Error(`docs-shots: no splitter right of ${id}`);
  }
  await ctx.page.mouse.move(at.x, at.y);
  await ctx.page.mouse.down();
  await ctx.page.mouse.move(at.x + (width - at.w), at.y, { steps: 8 });
  await ctx.page.mouse.up();
  await ctx.page.mouse.move(1, 1);
  await ctx.sleep(400);
}

/** Close every Import Manager section. */
async function closeImportSections(ctx) {
  for (const s of ['Import merged glb', 'Import TDP', 'Import standard GLB', 'Import RVM', 'Import STEP', 'Import IFC']) {
    await ctx.section('importManager', s, false);
  }
}

async function setTempImport(ctx, isOn) {
  await ctx.call('/src/state/assets/assets.actions.ts', 'assetsActions', 'setImportTemp', isOn);
  await ctx.sleep(300);
}

// -----------------------------------------------------------------------------
// steps
// -----------------------------------------------------------------------------

/** Create the project store through Store Config, as a user would. */
async function createStore(ctx) {
  await ctx.section('modelAssets', 'Store Config', true);
  await ctx.type({ ...MA, css: 'input[placeholder="New store name"]' }, STORE);
  await ctx.type({ ...MA, css: 'input[placeholder^="Description"]' }, STORE_NOTE);
  await ctx.click({ ...MA, text: 'Add store' });
  await ctx.section('modelAssets', 'Store Config', false);
}

/** The RVM walkthrough: stage five files, keep them in the store, import, and
 *  catch the progress overlay. */
async function importRvms(ctx) {
  await ctx.widen('importManager', PANEL_W);
  await stage(
    ctx,
    'Import RVM',
    RVM_FILES.map((n) => resolve(RVM_DIR, `${n}.RVM`)),
  );
  await setTempImport(ctx, false);
  await ctx.click({ ...IM, section: 'Import RVM', css: 'button[aria-haspopup="listbox"]', nth: 0 });
  await ctx.click({ within: '[role="listbox"]', text: STORE });
  const sec = { ...IM, section: 'Import RVM' };
  await ctx.shot('f12-rvm-staged', {
    crop: { el: sec },
    marks: [
      { n: 1, el: { ...sec, text: 'Select RVM file(s)…' } },
      { n: 2, el: { ...sec, tooltip: 'Session-only import' } },
      { n: 3, el: { ...sec, tooltip: 'Load whatever the import' } },
      { n: 4, el: { ...sec, tooltip: 'Don’t move the camera' } },
      { n: 5, el: { ...sec, css: 'button[aria-haspopup="listbox"]', nth: 0 } },
      { n: 6, el: { ...sec, css: 'input[placeholder^="(a folder"]' } },
      { n: 7, el: { ...sec, tooltip: 'Split the model' } },
      { n: 8, el: { ...sec, tooltip: 'Tessellation chord-height' } },
      { n: 9, el: { ...sec, tooltip: 'Include RVM Line' } },
      { n: 10, el: { ...sec, tooltip: 'Round circle' } },
      { n: 11, el: { ...sec, tooltip: 'Convert and cook the RVM' } },
      { n: 12, el: { ...sec, tooltip: 'Discard this RVM import' }, at: 'tr' },
    ],
  });
  await ctx.click({ ...sec, tooltip: 'Convert and cook the RVM' });
  await waitDialog(ctx);
  await ctx.shot('f12-progress', { crop: { el: { css: '[role="dialog"]' }, pad: 10 } });
  await waitImportIdle(ctx);

  // a quick look at one more file without keeping it — lands in the TEMP section
  await ctx.eval(
    async (n) => {
      const { assetsActions } = await import('/src/state/assets/assets.actions.ts');
      const bytes = await (await fetch(`/convertSamples/rvm/${n}.RVM`)).arrayBuffer();
      await assetsActions.importRvm(new File([bytes], `${n}.RVM`), { folder: `${n}.RVM`, temp: true, load: true, quiet: true });
    },
    TEMP_RVM,
  );
  await waitImportIdle(ctx);
  await closeImportSections(ctx);
}

async function importDatabase(ctx, dbPath) {
  await choose(ctx, 'sqlAssets', 'Which store', STORE);
  const input = await ctx.handle({ ...SQ, css: 'input[type="file"]' });
  await input.uploadFile(dbPath);
  await ctx.page.waitForFunction(
    async () => (await import('/src/state/sqlAssets/sqlAssets.state.ts')).sqlAssetsState.get().dbs.length > 0,
    { timeout: 60000, polling: 300 },
  );
  await ctx.sleep(500);
}

async function captureLayout(ctx) {
  await layout(ctx, 12);
  await ctx.click({ ...MA, text: 'Expand all' });
  // a click would scroll the panel's over-wide toolbar row sideways
  await ctx.call('/src/state/sqlAssets/sqlAssets.actions.ts', 'sqlAssetsActions', 'expandTree');
  await fitView(ctx);
  await ctx.shot('f12-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonHome') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('modelAssets') },
      { n: 4, el: stack('sqlAssets') },
      { n: 5, el: stack('viewport') },
      { n: 6, el: stack('console') },
      { n: 7, el: stack('importManager') },
      { n: 8, el: stack('export') },
    ],
  });
  await fitView(ctx);
  await ctx.shot('f12-task-import-viewport', { crop: 'viewport', gpu: true });
}

async function captureModelAssets(ctx) {
  await widenRight(ctx, 'modelAssets', PANEL_W);
  // the whole column, so the tree shows every row
  await ctx.close('sqlAssets');
  await ctx.click({ ...MA, text: 'Expand all' });
  await ctx.click({ ...MA, text: '_HA-PIPE.tdp' });
  await ctx.shot('f12-model-assets', {
    crop: { panel: 'modelAssets', fit: true },
    marks: [
      { n: 1, el: { ...MA, section: 'Store Config' } },
      { n: 2, el: { ...MA, text: 'Collapse all' } },
      { n: 3, el: { ...MA, text: 'Expand all' } },
      { n: 4, el: { ...MA, text: 'Delete' } },
      { n: 5, el: { ...MA, text: 'Load' } },
      { n: 6, el: { ...MA, text: 'Unload' } },
      { n: 7, el: { ...MA, text: 'Export' } },
      { n: 8, el: { ...MA, text: 'Select all' } },
      { n: 9, el: { ...MA, text: 'Deselect all' } },
      { n: 10, el: { ...MA, tooltip: 'Don\'t move the camera' } },
      { n: 11, el: { ...MA, tooltip: 'Models loaded at once' } },
      { n: 12, el: { ...MA, css: 'input[type="search"]' } },
      { n: 13, el: { ...MA, css: '[role="group"]' }, at: 'tr' },
      { n: 14, el: { ...MA, css: '[data-section="1"]', nth: 1 } },
      { n: 15, el: { ...MA, text: 'Rename' } },
    ],
  });

  await ctx.type({ ...MA, css: 'input[type="search"]' }, 'pipe | safe');
  await ctx.shot('f12-search', {
    crop: { union: [{ ...MA, css: 'input[type="search"]' }, { ...MA, text: '_HA-SAFE.tdp' }], pad: 8 },
  });
  await ctx.type({ ...MA, css: 'input[type="search"]' }, '');

  await ctx.section('modelAssets', 'Store Config', true);
  await ctx.shot('f12-store-config', {
    crop: { el: { ...MA, section: 'Store Config' } },
    marks: [
      { n: 1, el: { ...MA, css: 'input[placeholder="New store name"]' } },
      { n: 2, el: { ...MA, css: 'input[placeholder^="Description"]', nth: 0 } },
      { n: 3, el: { ...MA, text: 'Add store' } },
      { n: 4, el: { ...MA, tooltip: 'Delete this store' }, at: 'tr' },
      { n: 5, el: { ...MA, css: 'input[placeholder="Description"]' } },
    ],
  });
  await ctx.section('modelAssets', 'Store Config', false);
}

/** Right-click → New folder inside… → name it, then move the discipline
 *  folders into it (the drag-and-drop result, done through the action). */
async function captureFolders(ctx) {
  const band = await ctx.handle({ ...MA, css: '[data-section="1"]', nth: 1 });
  await band.click({ button: 'right' });
  await ctx.sleep(400);
  await ctx.shot('f12-folder-menu', {
    crop: { union: [{ ...MA, css: '[data-section="1"]', nth: 1 }, { css: '[role="menu"]' }], pad: 8 },
  });
  await ctx.click({ within: '[role="menu"]', text: 'New folder inside…' });
  await ctx.type({ within: '[role="dialog"]', css: 'input' }, 'Topside');
  // headless, a click on a dialog button does not land — answer it through the app
  await ctx.eval(async () => (await import('/src/components/dialogs/dialogs.actions.ts')).dialogs.resolvePrompt(true));
  await ctx.sleep(400);
  await ctx.eval(
    async (store, names) => {
      const { assetsActions } = await import('/src/state/assets/assets.actions.ts');
      for (const n of names) {
        await assetsActions.moveFolder(store, `${n}.RVM`, 'Topside');
      }
    },
    STORE,
    RVM_FILES,
  );
  await ctx.click({ ...MA, text: 'Collapse all' });
  await ctx.click({ ...MA, text: 'Expand all' });
  await ctx.shot('f12-folders', {
    crop: { union: [{ ...MA, css: '[data-section="1"]', nth: 1 }, { ...MA, text: '_HA-STRU.tdp' }], pad: 8 },
  });
}

async function captureImportManager(ctx) {
  await ctx.widen('importManager', PANEL_W);
  await ctx.section('importManager', 'Import merged glb', true);
  await ctx.section('importManager', 'Import TDP', true);
  await ctx.shot('f12-glb-tdp', {
    crop: { union: [{ ...IM, section: 'Import merged glb' }, { ...IM, section: 'Import TDP' }] },
    marks: [
      { n: 1, el: { ...IM, section: 'Import merged glb', text: 'Select folder…' } },
      { n: 2, el: { ...IM, text: 'Select files…' } },
      { n: 3, el: { ...IM, section: 'Import TDP', text: 'Select folder…' } },
      { n: 4, el: { ...IM, text: 'Folder + subfolders…' } },
    ],
  });
  await closeImportSections(ctx);

  // the shared rows, as they start out: Temp ticked, so the store is not asked for
  await setTempImport(ctx, true);
  await stage(ctx, 'Import IFC', [IFC_SAMPLE]);
  const ifc = { ...IM, section: 'Import IFC' };
  await ctx.shot('f12-import-options', {
    crop: { union: [{ ...ifc, tooltip: 'Session-only import' }, { ...ifc, css: 'input[placeholder="(none)"]' }] },
  });
  await ctx.shot('f12-ifc', {
    crop: { el: ifc },
    marks: [
      { n: 1, el: { ...ifc, tooltip: 'Split into one file' } },
      { n: 2, el: { ...ifc, tooltip: 'Tessellation quality' } },
      { n: 3, el: { ...ifc, tooltip: 'IfcSpace handling' } },
      { n: 4, el: { ...ifc, tooltip: 'Opening (void)' } },
      { n: 5, el: { ...ifc, tooltip: 'Recenter the model' } },
    ],
  });
  await closeImportSections(ctx);

  await stage(ctx, 'Import STEP', [STEP_SAMPLE]);
  const step = { ...IM, section: 'Import STEP' };
  await ctx.shot('f12-step', {
    crop: { el: step },
    marks: [
      { n: 1, el: { ...step, tooltip: 'Chordal sag' } },
      { n: 2, el: { ...step, tooltip: 'Max chord turn' } },
      { n: 3, el: { ...step, tooltip: 'Tessellation sub-workers' } },
      { n: 4, el: { ...step, tooltip: 'Weld duplicate' } },
    ],
  });
  await closeImportSections(ctx);

  await stage(ctx, 'Import standard GLB', [GLB_SAMPLE]);
  const std = { ...IM, section: 'Import standard GLB' };
  await ctx.shot('f12-stdglb', {
    crop: { el: std },
    marks: [
      { n: 1, el: { ...std, tooltip: 'Keep authored normals' } },
      { n: 2, el: { ...std, tooltip: 'Draw edge lines' } },
    ],
  });

  // stage every format so the reference table covers every option
  await stage(ctx, 'Import RVM', [resolve(RVM_DIR, 'HA-PIPE.RVM')]);
  await stage(ctx, 'Import STEP', [STEP_SAMPLE]);
  await stage(ctx, 'Import IFC', [IFC_SAMPLE]);
  await ctx.section('importManager', 'Import merged glb', true);
  await ctx.section('importManager', 'Import TDP', true);
  await ctx.harvest('importManager', {
    rename: {
      'Finer RVM': 'Tolerance −',
      'Coarser RVM': 'Tolerance +',
      'Finer STEP tessellation (smaller chordal': 'Deflection −',
      'Coarser STEP tessellation (larger chordal': 'Deflection +',
      'Finer STEP tessellation (smaller max': 'Max angle −',
      'Coarser STEP tessellation (larger max': 'Max angle +',
      'One fewer STEP': 'Workers −',
      'One more STEP': 'Workers +',
      'Split the model': 'Split (RVM)',
      'Split into one file': 'Split (IFC)',
      'Tessellation quality': 'Quality',
      'IfcSpace handling': 'Spaces',
      'Opening (void)': 'Openings',
      'Tessellation chord-height': 'Tolerance',
      'Chordal sag': 'Deflection',
      'Max chord turn': 'Max angle',
      'Tessellation sub-workers': 'Workers',
    },
    skip: ['About importing', 'Session-only import', 'Load whatever the import', 'Don’t move the camera'],
    extra: [
      {
        section: 'Import merged glb',
        label: 'Pool',
        tooltip: 'Shown once a folder is picked: how many files are cooked at the same time. Each one holds a whole GLB in memory while it cooks.',
        keys: 'ALT 607 / ALT 606',
      },
      {
        section: 'Every import section',
        label: 'Temp import (don’t keep in store)',
        tooltip: 'Session-only import: the model is loaded now but not kept — it is removed from the browser the next time the app starts. On by default.',
        keys: 'ALT 1201',
      },
      {
        section: 'Every import section',
        label: 'Load after import',
        tooltip: 'Show what the import produced in the 3D view as soon as it finishes. Always on for temp imports.',
        keys: 'ALT 638',
      },
      {
        section: 'Every import section',
        label: 'Keep camera',
        tooltip: 'Do not move the camera when the imported models load.',
        keys: 'ALT 623',
      },
      {
        section: 'Every import section',
        label: 'Store',
        tooltip: 'The store a kept import goes into. Greyed out while Temp import is ticked; Import stays greyed out until you pick one.',
      },
      {
        section: 'Every import section',
        label: 'Folder',
        tooltip: 'The folder in the store the import lands in. Filled in from the file name; empty = no folder.',
      },
    ],
  });
}

async function captureSqlAssets(ctx) {
  await widenRight(ctx, 'sqlAssets', SQL_PANEL_W);
  // clicks would scroll the over-wide toolbar row sideways — use the actions
  const sql = '/src/state/sqlAssets/sqlAssets.actions.ts';
  await ctx.call(sql, 'sqlAssetsActions', 'expandTree');
  await ctx.call(sql, 'sqlAssetsActions', 'setSelection', [`sql_assets/${STORE}/plant-data.db`]);
  await ctx.sleep(400);
  await ctx.shot('f12-sql-assets', {
    crop: { panel: 'sqlAssets' },
    marks: [
      { n: 1, el: { ...SQ, section: 'Store Config' } },
      { n: 2, el: { ...SQ, tooltip: 'Which store' } },
      { n: 3, el: { ...SQ, text: 'Import Database' } },
      { n: 4, el: { ...SQ, text: 'Delete Selected' } },
      { n: 5, el: { ...SQ, text: 'Select all' } },
      { n: 6, el: { ...SQ, text: 'Collapse all' } },
      { n: 7, el: { ...SQ, text: 'plant-data.db' } },
    ],
  });
  await ctx.section('sqlAssets', 'Store Config', true);
  await ctx.harvest('sqlAssets', {
    rename: { 'Delete this store': 'Delete store', 'Which store': 'Import to' },
    extra: [
      { section: 'Store Config', label: 'New store name / Description', tooltip: 'Name and note for a new store.', first: true },
    ],
  });
  await ctx.section('sqlAssets', 'Store Config', false);
}

async function captureExport(ctx) {
  const tdp = { ...EX, section: 'TDP (TreDeSpace)' };
  const glb = { ...EX, section: 'GLB' };
  const ifc = { ...EX, section: 'IFC' };
  await ctx.shot('f12-export-formats', {
    crop: { union: [tdp, ifc] },
    marks: [
      { n: 1, el: { ...tdp, tooltip: 'Leave out parts clipped' } },
      { n: 2, el: { ...tdp, text: 'Export merged TDP (per color)' } },
      { n: 3, el: { ...tdp, text: 'Export hierarchy TDP' } },
      { n: 4, el: { ...glb, tooltip: 'Shift the model' } },
      { n: 5, el: { ...glb, tooltip: 'Keep the app' } },
      { n: 6, el: { ...glb, text: 'Export merged GLB (per color)' } },
      { n: 7, el: { ...glb, text: 'Export hierarchy GLB' } },
      { n: 8, el: { ...ifc, text: 'Export merged IFC' } },
      { n: 9, el: { ...ifc, text: 'Export hierarchy IFC' } },
    ],
  });
  await ctx.section('export', 'TDP (TreDeSpace)', false);
  await ctx.section('export', 'GLB', false);
  await ctx.section('export', 'IFC', false);
  const snap = { ...EX, section: 'State snapshot' };
  await ctx.shot('f12-export-snapshot', {
    crop: { el: snap },
    marks: [
      { n: 1, el: { ...snap, tooltip: 'Save only items with an override' } },
      { n: 2, el: { ...snap, tooltip: 'Include color, opacity' } },
      { n: 3, el: { ...snap, tooltip: 'Include moved' } },
      { n: 4, el: { ...snap, tooltip: 'Leave plain white' } },
      { n: 5, el: { ...snap, tooltip: 'Do not record which' } },
      { n: 6, el: { ...snap, tooltip: 'Save only models loaded' } },
      { n: 7, el: { ...snap, text: 'Save snapshot' } },
      { n: 8, el: { ...snap, tooltip: 'Apply the file\'s color' } },
      { n: 9, el: { ...snap, tooltip: 'Apply the file\'s transforms' } },
      { n: 10, el: { ...snap, tooltip: 'Ignore plain white' } },
      { n: 11, el: { ...snap, tooltip: 'Ignore the file\'s hidden' } },
      { n: 12, el: { ...snap, tooltip: 'Apply only onto models' } },
      { n: 13, el: { ...snap, text: 'Load snapshot…' } },
    ],
  });
  await ctx.section('export', 'TDP (TreDeSpace)', true);
  await ctx.section('export', 'GLB', true);
  await ctx.section('export', 'IFC', true);
  await ctx.harvest('export', {
    rename: {
      'Leave out parts clipped': 'Exclude clipped parts',
      'Pick a .tdsnap': 'Load snapshot…',
      'Save only models loaded': 'Store (save)',
      'Apply only onto models': 'Store (load)',
    },
  });
}

async function f12Scene(ctx) {
  const dbPath = makeSampleDb();
  await layout(ctx, 12);
  await createStore(ctx);
  await importRvms(ctx);
  await importDatabase(ctx, dbPath);
  await captureLayout(ctx);
  await captureModelAssets(ctx);
  await captureFolders(ctx);
  await ctx.section('modelAssets', 'Store Config', true);
  await ctx.harvest('modelAssets', {
    rename: {
      'Delete this store': 'Delete store',
      'Models loaded at once': 'Pool',
      'Fewer parallel asset loads': 'Pool −',
      'More parallel asset loads': 'Pool +',
    },
    extra: [
      { section: 'Store Config', label: 'New store name / Description', tooltip: 'Name and note for a new store.', first: true },
      {
        section: '',
        label: 'Search',
        tooltip: 'Filter by name, folder or store. a & b = both, a | b = either, parentheses group.',
      },
    ],
  });
  await ctx.section('modelAssets', 'Store Config', false);
  await layout(ctx, 12);
  await captureImportManager(ctx);
  await layout(ctx, 12);
  await captureSqlAssets(ctx);
  await captureExport(ctx);
}

export const scene = { id: 'f12', run: f12Scene };
