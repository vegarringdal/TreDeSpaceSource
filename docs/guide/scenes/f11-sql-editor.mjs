// Guide scene: F11 SQL Editor (f11-sql-editor.html) — the SQL workspace and its
// four panels: Sql Report (SQL Reports), SQL Editor, SQL Table, SQL Detail.
//
// There is no sample database in the repo, so one is BUILT here at scene time:
// the tag names are read from the loaded Huldra models (the model DB worker),
// a small SQLite file is written with node:sqlite in a temp dir (rollback
// journal, never WAL), and imported through the SQL Assets import action into
// the "main" store. The file is deleted again afterwards — it is never
// committed. Four example reports are saved into main's SQL_Reports.json.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitView, layout, SAMPLES, select, stack, VIEWER } from './_lib.mjs';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const REPORTS = '/src/state/sqlReports/sqlReports.actions.ts';
const EDITOR = '/src/state/sqlAssets/sqlEditor.actions.ts';
const DETAIL = '/src/components/panels/sql-detail/sqlDetailPanel.ts';
const DB_FILE = 'huldra-tags.db';
const DB_PATH = `sql_assets/main/${DB_FILE}`;
const SPEAKER = '/SX-HA86-011A';
/** Width of the Sql Report panel for the report-editor pictures. */
const REPORT_W = 440;

/** The top-level systems the sample tags are taken from, with their discipline. */
const DISCIPLINES = { '/HA-TELE': 'Telecom', '/HA-SAFE': 'Safety', '/HA-PIPE': 'Piping' };
const PER_DISCIPLINE = 60;

const R = { panel: 'sqlReports' };
const ED = { panel: 'sqlEditor' };
const TB = { panel: 'sqlTable' };
const DT = { panel: 'sqlDetail' };
const EDIT_BOX = { ...R, css: 'div.border-sky-800' };

// -----------------------------------------------------------------------------
// sample database
// -----------------------------------------------------------------------------

/** Every entry two levels under a discipline node (/HA-TELE → system → tag),
 *  read from the loaded models: [{ name, system, top }]. The discipline nodes
 *  are found by a shallow walk from each model's roots. */
async function harvestNames(ctx) {
  return ctx.eval(async (tops) => {
    const { db } = await import('/src/state/viewer/db.ts');
    const out = [];
    const groups = [...new Set((await db.slotSummaries()).filter((s) => !s.removed).map((s) => s.group))];
    for (const group of groups) {
      for (const { model, node } of await db.groupRoots(group)) {
        let level = [node];
        for (let depth = 0; depth < 3 && level.length; depth++) {
          const next = [];
          for (const n of level) {
            if (!tops.includes(n.name)) {
              next.push(...(await db.children(model, n.entry)));
              continue;
            }
            for (const sys of await db.children(model, n.entry)) {
              for (const tag of await db.children(model, sys.entry)) {
                out.push({ name: tag.name, system: sys.name, top: n.name });
              }
            }
          }
          level = next;
        }
      }
    }
    return out;
  }, Object.keys(DISCIPLINES));
}

/** A small stable hash, so the made-up columns are the same on every run. */
function hash(s) {
  let h = 2166136261;
  for (const c of s) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  }
  return h;
}

const DESCRIPTIONS = [
  ['SX-', 'PA loudspeaker'],
  ['LY-', 'Signal lamp'],
  ['TBE-', 'Terminal box'],
  ['DG-', 'Gas detector'],
  ['DF-', 'Flame detector'],
  ['DS-', 'Smoke detector'],
  ['DE-', 'Heat detector'],
  ['PL-', 'Pipe line'],
];
const STATUSES = ['Commissioned', 'Installed', 'Installed', 'Punch open', 'Not started'];
const AREAS = ['Cellar deck', 'Mezzanine deck', 'Main deck', 'Weather deck'];
const DAY_MS = 86400000;
const FIRST_DAY = Date.UTC(2025, 0, 6);

function describe(tag, discipline) {
  const hit = DESCRIPTIONS.find(([p]) => tag.startsWith(p));
  return hit ? hit[1] : `${discipline} equipment`;
}

/** Rows for the `tags` and `documents` tables from the harvested names. */
function makeRows(names) {
  const tags = [];
  const docs = [];
  for (const [top, discipline] of Object.entries(DISCIPLINES)) {
    const picked = names
      .filter((n) => n.top === top && !n.name.slice(1).includes('/'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, PER_DISCIPLINE);
    for (const n of picked) {
      const tag = n.name.slice(1);
      const h = hash(tag);
      const status = STATUSES[h % STATUSES.length];
      const date =
        status === 'Not started' ? null : new Date(FIRST_DAY + ((h >>> 8) % 400) * DAY_MS).toISOString().slice(0, 10);
      tags.push({
        fullname: n.name,
        tag,
        description: describe(tag, discipline),
        discipline,
        system: n.system.slice(1),
        area: AREAS[(h >>> 4) % AREAS.length],
        status,
        install_date: date,
        datasheet_url: `https://example.com/datasheets/${tag}.pdf`,
      });
      const code = discipline[0];
      docs.push([tag, `HUL-${code}-DS-${(h % 9000) + 1000}`, 'Datasheet', `https://example.com/docs/${tag}-ds.pdf`]);
      if (h % 3 === 0) {
        docs.push([
          tag,
          `HUL-${code}-IN-${(h % 7000) + 2000}`,
          'Installation procedure',
          `https://example.com/docs/${tag}-in.pdf`,
        ]);
      }
    }
  }
  return { tags, docs };
}

/** Write the SQLite file (rollback journal — never WAL) and return its bytes. */
function buildDatabase(names) {
  const dir = mkdtempSync(join(tmpdir(), 'f11-sql-'));
  const file = join(dir, DB_FILE);
  try {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec(`CREATE TABLE tags (
      fullname TEXT PRIMARY KEY, tag TEXT, description TEXT, discipline TEXT, system TEXT,
      area TEXT, status TEXT, install_date TEXT, datasheet_url TEXT)`);
    db.exec('CREATE TABLE documents (tag TEXT, doc_no TEXT, title TEXT, url TEXT)');
    const { tags, docs } = makeRows(names);
    const insTag = db.prepare(
      'INSERT INTO tags VALUES (:fullname, :tag, :description, :discipline, :system, :area, :status, :install_date, :datasheet_url)',
    );
    for (const t of tags) {
      insTag.run(t);
    }
    const insDoc = db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?)');
    for (const d of docs) {
      insDoc.run(...d);
    }
    db.close();
    console.log(`  · sample db: ${tags.length} tags, ${docs.length} documents`);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function importDatabase(ctx, bytes) {
  await ctx.eval(
    async (b64, name) => {
      const { sqlAssetsActions } = await import('/src/state/sqlAssets/sqlAssets.actions.ts');
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await sqlAssetsActions.importDatabases([new File([bin], name)], 'main', { replace: true, quiet: true });
    },
    bytes.toString('base64'),
    DB_FILE,
  );
}

// -----------------------------------------------------------------------------
// example reports
// -----------------------------------------------------------------------------

const report = (id, name, description, types, sql, filters = []) => ({
  id,
  store: 'main',
  db: DB_PATH,
  name,
  description,
  types,
  sql,
  databases: [DB_PATH],
  filters,
});

const BY_DISCIPLINE = report(
  'f11-by-discipline',
  'Tags by discipline',
  'Every tag of the chosen disciplines. Pick **none** to list them all.',
  ['TABLE', 'COLORING'],
  `SELECT fullname, tag, description, discipline, system, area, status
FROM tags
WHERE discipline IN (SELECT v FROM FILTER_ARGS WHERE k = 'discipline')
   OR NOT EXISTS (SELECT 1 FROM FILTER_ARGS WHERE k = 'discipline')
ORDER BY tag;`,
  [
    {
      kind: 'DROPDOWN',
      key: 'discipline',
      label: 'Discipline',
      searchValue: '%',
      dropdownSql: 'SELECT DISTINCT discipline AS id, discipline AS label\nFROM tags WHERE discipline LIKE ? ORDER BY 1',
      selected: ['Telecom'],
    },
  ],
);

const STATUS = report(
  'f11-status',
  'Tag status',
  'Green = commissioned, blue = installed, orange = punch open, red = not started.',
  ['COLORING', 'TABLE'],
  `SELECT fullname,
       CASE status
         WHEN 'Commissioned' THEN 'green'
         WHEN 'Installed'    THEN '#1c7ed6'
         WHEN 'Punch open'   THEN 'orange'
         ELSE 'red'
       END AS fullname_color,
       tag, status, install_date
FROM tags
ORDER BY status, tag;`,
);

const SINCE = report(
  'f11-since',
  'Installed since',
  'Tags installed on or after a date (YYYY-MM-DD).',
  ['TABLE', 'COLORING'],
  `SELECT fullname, tag, description, install_date
FROM tags
WHERE install_date >= (SELECT v FROM FILTER_ARGS WHERE k = 'since')
ORDER BY install_date;`,
  [{ kind: 'INPUT', key: 'since', label: 'Installed since', value: '2025-09-01' }],
);

const CARD = report(
  'f11-card',
  'Tag card',
  'Click an item in the model to see its tag data and documents.',
  ['DETAIL'],
  `SELECT t.tag, t.description, t.discipline, t.system, t.area, t.status,
       t.install_date, t.datasheet_url AS datasheet,
       (SELECT json_group_array(json_object(
                 'label', d.doc_no, 'value', d.url, 'value_link_label', d.title))
          FROM documents d WHERE d.tag = t.tag) AS documents
FROM TREE_VIEW_ARGS a
JOIN tags t ON lower(t.fullname) = lower(a.FULLNAME)
ORDER BY a.rowid;`,
);

const EDITOR_SQL = `SELECT discipline, status, count(*) AS tags
FROM tags
GROUP BY discipline, status
ORDER BY discipline, status;`;

async function saveReports(ctx) {
  await ctx.call(REPORTS, 'sqlReportsActions', 'setStore', 'main');
  for (const r of [BY_DISCIPLINE, STATUS, SINCE, CARD]) {
    await ctx.call(REPORTS, 'sqlReportsActions', 'save', r);
  }
  await ctx.sleep(300);
}

// -----------------------------------------------------------------------------
// shots
// -----------------------------------------------------------------------------

async function captureLayout(ctx) {
  await ctx.call(EDITOR, 'sqlEditorActions', 'setFromReport', STATUS);
  await ctx.call(REPORTS, 'sqlReportsActions', 'runTable', BY_DISCIPLINE);
  await ctx.call(DETAIL, 'bindDetailReport', null, CARD);
  await select(ctx, SPEAKER);
  await ctx.sleep(800);
  await ctx.shot('f11-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonHome') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('sqlReports') },
      { n: 4, el: stack('sqlEditor') },
      { n: 5, el: stack('viewport') },
      { n: 6, el: stack('sqlTable') },
      { n: 7, el: stack('console') },
      { n: 8, el: stack('sqlDetail') },
    ],
  });
}

async function captureReports(ctx) {
  await ctx.shot('f11-reports-list', {
    crop: { panel: 'sqlReports', fit: true },
    marks: [
      { n: 1, el: { ...R, tooltip: 'Reports are grouped by store' } },
      { n: 2, el: { ...R, text: 'New report' } },
      { n: 3, el: { ...R, css: 'input[placeholder="Search reports…"]' } },
      { n: 4, el: { ...R, text: 'Tag status' } },
      { n: 5, el: { ...R, tooltip: 'Edit this report', nth: 1 }, at: 'tr' },
    ],
  });

  await ctx.call(REPORTS, 'sqlReportsActions', 'setOpen', BY_DISCIPLINE.id);
  await ctx.shot('f11-report-run', {
    crop: { el: { ...R, section: 'Tags by discipline' } },
    marks: [
      { n: 1, el: { ...R, re: '^Every tag of the chosen' } },
      { n: 2, el: { ...R, section: 'Tags by discipline', css: 'label' } },
      { n: 3, el: { ...R, section: 'Tags by discipline', text: 'Table' } },
      { n: 4, el: { ...R, section: 'Tags by discipline', text: 'Coloring' } },
    ],
  });

  await ctx.call(REPORTS, 'sqlReportsActions', 'setOpen', STATUS.id);
  const ST = { ...R, section: 'Tag status' };
  await ctx.click({ ...ST, text: 'Coloring' });
  await ctx.sleep(500);
  const box = { ...ST, re: '^[\\d,]+ rows — apply as:$' };
  await ctx.shot('f11-report-coloring', {
    crop: { el: { ...R, section: 'Tag status' } },
    marks: [
      { n: 1, el: box },
      { n: 2, el: { ...ST, text: 'Set color' } },
      { n: 3, el: { ...ST, text: 'White' } },
      { n: 4, el: { ...ST, text: 'Hidden' } },
      { n: 5, el: { ...ST, text: 'Transparent' } },
      { n: 6, el: { ...ST, text: 'Selection' } },
    ],
  });
  await harvestReportList(ctx);
}

/** Local helper (the runner's widen only drags the LEFT splitter): drag the
 *  vertical splitter on the right edge of panel `id`'s stack so the stack is
 *  `width` px wide — the panels to its right give up the room. */
async function widenRight(ctx, id, width) {
  const r = await ctx.eval((i) => {
    const st = document.querySelector(`.dock-panel[data-panel="${i}"]`)?.closest('section.dock-tabs');
    const b = st?.getBoundingClientRect();
    if (!b) {
      return null;
    }
    for (const sp of document.querySelectorAll('.dock-splitter')) {
      const q = sp.getBoundingClientRect();
      if (q.height > q.width && Math.abs(q.left - b.right) < 8 && q.top <= b.top + 1 && q.bottom >= b.bottom - 1) {
        return { x: q.left + q.width / 2, y: b.top + b.height / 2, w: b.width };
      }
    }
    return null;
  }, id);
  if (!r) {
    throw new Error(`f11: no splitter right of ${id}`);
  }
  await ctx.page.mouse.move(r.x, r.y);
  await ctx.page.mouse.down();
  await ctx.page.mouse.move(r.x + (width - r.w), r.y, { steps: 8 });
  await ctx.page.mouse.up();
  await ctx.page.mouse.move(1, 1);
  await ctx.sleep(400);
}

/** Scroll a panel so the element `spec` sits at the top of its scroller. */
async function scrollTo(ctx, spec) {
  await ctx.eval((sp) => window.__doc.find(sp)?.scrollIntoView({ block: 'start' }), spec);
  await ctx.sleep(300);
}

/** The report editor is tall and wide: shown with the Hierarchy closed so the
 *  Sql Report panel gets its width; the layout is re-applied afterwards. */
async function captureReportEditor(ctx) {
  await ctx.close('hierarchy');
  await widenRight(ctx, 'sqlReports', REPORT_W);
  await ctx.call(REPORTS, 'sqlReportsActions', 'setOpen', null);
  await ctx.call(REPORTS, 'sqlReportsActions', 'setEdit', BY_DISCIPLINE.id);
  await scrollTo(ctx, EDIT_BOX);
  await ctx.shot('f11-report-edit', {
    crop: {
      union: [{ ...R, css: 'div.border-sky-800 input', nth: 0 }, { ...R, css: 'div.border-sky-800 div.resize-y' }, { ...R, text: 'As Detail' }],
      pad: 10,
    },
    marks: [
      { n: 1, el: { ...R, css: 'div.border-sky-800 input', nth: 0 } },
      { n: 2, el: { ...R, css: 'div.border-sky-800 textarea', nth: 0 } },
      { n: 3, el: { ...R, tooltip: 'The database opened directly' } },
      { n: 4, el: { ...R, tooltip: 'Enable the COLORING output' } },
      { n: 5, el: { ...R, css: 'div.border-sky-800 div.resize-y', nth: 0 } },
      { n: 6, el: { ...R, text: 'As Table' } },
      { n: 7, el: { ...R, text: 'Color White' } },
      { n: 8, el: { ...R, text: 'As Detail' } },
    ],
  });
  await scrollTo(ctx, { ...R, text: 'Add filter' });
  await ctx.shot('f11-report-filter', {
    crop: { union: [{ ...R, text: 'Add filter' }, { ...R, text: 'Delete' }, { ...R, section: 'Discipline' }], pad: 10 },
    marks: [
      { n: 1, el: { ...R, text: 'Add filter' } },
      { n: 2, el: { ...R, section: 'Discipline', css: 'button[aria-haspopup]', nth: 0 } },
      { n: 3, el: { ...R, css: 'input[placeholder="key (FILTER_ARGS.k)"]' } },
      { n: 4, el: { ...R, css: 'input[placeholder="Label"]' } },
      { n: 5, el: { ...R, css: 'input[placeholder^="Search bind default"]' } },
      { n: 6, el: { ...R, section: 'Discipline', css: 'div.resize-y' } },
      { n: 7, el: { ...R, text: 'Single select' } },
      { n: 8, el: { ...R, tooltip: 'Also the predefined selection' } },
      { n: 9, el: { ...R, text: 'Save' } },
      { n: 10, el: { ...R, text: 'Set editor' } },
    ],
  });
  await harvestReportEditor(ctx);
  await layout(ctx, 11);
}

async function captureEditor(ctx) {
  await ctx.call(EDITOR, 'sqlEditorActions', 'setFromReport', {
    ...BY_DISCIPLINE,
    name: 'Tags per status',
    description: 'How many tags each discipline has in each status.',
    sql: EDITOR_SQL,
    types: ['COLORING', 'TABLE', 'DETAIL'],
    filters: [],
  });
  await ctx.click({ ...ED, text: 'Run' });
  await ctx.sleep(600);
  await ctx.shot('f11-editor', {
    crop: { panel: 'sqlEditor', fit: true },
    marks: [
      { n: 1, el: { ...ED, text: 'Clear' } },
      { n: 2, el: { ...ED, text: 'Save Local' } },
      { n: 3, el: { ...ED, tooltip: 'The database opened directly' } },
      { n: 4, el: { ...ED, tooltip: 'Enable the COLORING output' } },
      { n: 5, el: { ...ED, css: 'div.resize-y' } },
      { n: 6, el: { ...ED, text: 'Run' } },
      { n: 7, el: { ...ED, text: 'Shared' } },
      { n: 8, el: { ...ED, text: 'Kill' } },
      { n: 9, el: { ...ED, text: 'Color White' } },
      { n: 10, el: { ...ED, text: 'As Table' } },
      { n: 11, el: { ...ED, text: 'Add filter' } },
      { n: 12, el: { ...ED, re: '^Will lock:' } },
      { n: 13, el: { ...ED, re: '^last run:' } },
    ],
  });
  await ctx.click({ ...ED, text: 'As Table' });
  await ctx.sleep(500);
  await ctx.shot('f11-editor-table', { crop: { panel: 'sqlTable', fit: true } });
}

async function captureTable(ctx) {
  await ctx.call(REPORTS, 'sqlReportsActions', 'runTable', BY_DISCIPLINE);
  await ctx.sleep(400);
  await ctx.type({ ...TB, css: 'input[placeholder="filter…"]', nth: 1 }, 'SX-');
  await ctx.click({ ...TB, css: 'button[title="tag"]' });
  await ctx.click({ ...TB, css: 'button[title^="Click to select"]', nth: 1 });
  await ctx.page.keyboard.down('Shift');
  await ctx.click({ ...TB, css: 'button[title^="Click to select"]', nth: 3 });
  await ctx.page.keyboard.up('Shift');
  await ctx.shot('f11-table', {
    crop: { panel: 'sqlTable' },
    marks: [
      { n: 1, el: { ...TB, re: '^\\d+ of \\d+ rows$' } },
      { n: 2, el: { ...TB, text: 'Load all' } },
      { n: 3, el: { ...TB, text: 'Clear on close' } },
      { n: 4, el: { ...TB, css: 'button[title="tag"]' } },
      { n: 5, el: { ...TB, css: 'input[placeholder="filter…"]', nth: 1 } },
      { n: 6, el: { ...TB, css: 'button[title^="Click to select"]', nth: 0 }, at: 'bl' },
      { n: 7, el: { ...TB, tooltip: 'Select every row shown' }, at: 'tr' },
    ],
  });
  const at = await ctx.eval(() => {
    const r = window.__doc.rectOf({ panel: 'sqlTable', css: 'button[title^="Click to select"]', nth: 2 });
    return { x: r.x + 200, y: r.y + r.h / 2 };
  });
  await ctx.page.mouse.click(at.x, at.y, { button: 'right' });
  await ctx.sleep(400);
  await ctx.shot('f11-table-menu', { crop: { el: { css: '[role="menu"]' } } });
  await ctx.page.keyboard.press('Escape');
  await ctx.sleep(300);
}

async function captureDetail(ctx) {
  await select(ctx, SPEAKER);
  await ctx.sleep(800);
  await ctx.shot('f11-detail', {
    crop: { panel: 'sqlDetail', fit: true },
    marks: [
      { n: 1, el: { ...DT, text: 'Listening' } },
      { n: 2, el: { ...DT, css: 'input[type="search"]' } },
      { n: 3, el: { ...DT, text: 'Hide empty' } },
      { n: 4, el: { ...DT, text: 'datasheet' } },
      { n: 5, el: { ...DT, re: '^HUL-T-DS-' } },
    ],
  });
}

/** Task pictures that only make sense with the 3D view. */
async function captureViewport(ctx) {
  const packed = async (r, how) => {
    await ctx.eval(
      async (rep, mode, mod) => {
        const { sqlReportsActions } = await import(mod);
        const rows = await sqlReportsActions.runColoring(rep);
        if (rows) {
          await sqlReportsActions[mode](rows);
        }
      },
      r,
      how,
      REPORTS,
    );
  };
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
  await packed(STATUS, 'colorWhite');
  await fitView(ctx);
  await ctx.shot('f11-task-white-viewport', { crop: 'viewport', gpu: true });
  await packed(BY_DISCIPLINE, 'colorHidden');
  await fitView(ctx);
  await ctx.shot('f11-task-hidden-viewport', { crop: 'viewport', gpu: true });
  await ctx.call(VIEWER, 'viewerActions', 'clearAllOverrides');
  await packed(SINCE, 'colorSelection');
  await ctx.call(VIEWER, 'viewerActions', 'flyToSelection');
  await ctx.sleep(ctx.hasGpu ? 1500 : 200);
  await ctx.shot('f11-task-select-viewport', { crop: 'viewport', gpu: true });
}

// -----------------------------------------------------------------------------
// reference tables
// -----------------------------------------------------------------------------

const REPORT_NAMES = '^(Tags by discipline|Tag status|Installed since|Tag card)';

/** The panel as a report user sees it: store, list, one report run with its
 *  colouring choices open (taken right after the Coloring click). */
async function harvestReportList(ctx) {
  await ctx.harvest('sqlReports', {
    sectionAlias: { [REPORT_NAMES]: 'A report' },
    rename: { 'Edit this report': 'Edit (pencil)', 'Reports are grouped by store': 'Store' },
    extra: [{ section: '', label: 'Search reports…', tooltip: 'Show only the reports whose name or description contains the text' }],
  });
}

/** The report editor's controls, as their own table. */
async function harvestReportEditor(ctx) {
  await ctx.harvest('sqlReports', {
    key: 'sqlReportsEditor',
    sectionAlias: { '': 'Report editor', '^Discipline': 'A filter' },
    skip: [
      'Reports are grouped',
      'Create a new report',
      'Edit this report',
      'Run and show the result',
      'Run the coloring',
      'Enable the TABLE',
      'Enable the DETAIL',
    ],
    rename: {
      'Expand all filters': 'Expand all',
      'Collapse all filters': 'Collapse all',
      'Move this filter up': 'Move up',
      'Move this filter down': 'Move down',
      'Remove this filter': 'Remove filter',
      'The database opened directly': 'Main db',
      'Also the predefined selection': 'Test/selected',
      'How report SQL runs': 'Info (i)',
      'Enable the COLORING': 'Types: COLORING / TABLE / DETAIL',
    },
    extra: [
      {
        section: 'Report editor',
        label: 'Description',
        tooltip: 'Shown above the report’s filters — **bold** and new lines work',
        first: true,
      },
      { section: 'Report editor', label: 'Name', tooltip: 'The report name shown in the list', first: true },
      { section: 'A filter', label: 'Input / Dropdown', tooltip: 'A text box, or a list filled by the dropdown SQL' },
      { section: 'A filter', label: 'key / Label', tooltip: 'The name the SQL reads (FILTER_ARGS.k) and the text shown beside the input' },
      { section: 'A filter', label: 'Default value / search default', tooltip: 'Input: the value filled in at the start. Dropdown: the search used while the box is empty (usually %)' },
      { section: 'A filter', label: 'Dropdown SQL', tooltip: 'The query that fills the list: an id column and a label column; ? is the search text' },
    ],
  });
}

async function harvestPanels(ctx) {
  await ctx.harvest('sqlEditor', {
    rename: {
      'Expand all filters': 'Expand all',
      'Collapse all filters': 'Collapse all',
      'The database opened directly': 'Main db',
      'How report SQL runs': 'Info (i)',
      'Enable the COLORING': 'Types: COLORING / TABLE / DETAIL',
    },
    skip: ['Enable the TABLE', 'Enable the DETAIL'],
    extra: [
      { section: '', label: 'Name / Description', tooltip: 'The name and text a report saved from here gets', first: true },
      { section: '', label: 'SQL box', tooltip: 'The SQL. Ctrl+Enter runs; Tab / Shift+Tab indent. Highlight part of it to run only that part.' },
    ],
  });
  await ctx.harvest('sqlTable', {
    rename: { 'Select every row shown': 'Select all (corner box)' },
    extra: [
      { section: '', label: 'Column title', tooltip: 'Click to sort A→Z, again Z→A, a third time unsorted. Drag the edge to resize.' },
      { section: '', label: 'filter…', tooltip: 'Show only rows whose value in this column contains the text (all filled columns must match)' },
      { section: '', label: 'Row number', tooltip: 'Click to select a row — Ctrl adds or removes one, Shift selects a range' },
      { section: '', label: 'Export to Excel (all)', tooltip: 'Right-click menu: every row as shown to an .xlsx file', keys: 'ALT 654' },
      { section: '', label: 'Export to Excel (selected rows)', tooltip: 'Right-click menu: only the selected rows', keys: 'ALT 655' },
      { section: '', label: 'Copy to clipboard (all)', tooltip: 'Right-click menu: every row as shown, tab-separated', keys: 'ALT 656' },
      { section: '', label: 'Copy to clipboard (selected rows)', tooltip: 'Right-click menu: only the selected rows', keys: 'ALT 657' },
    ],
  });
  // an empty form, so the field rows of the shown item stay out of the table
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
  await ctx.call(DETAIL, 'bindDetailReport', null, { ...CARD });
  await ctx.sleep(400);
  await ctx.harvest('sqlDetail', {
    extra: [{ section: '', label: 'Filter fields…', tooltip: 'Show only the fields whose name or value contains the text' }],
  });
}

async function f11Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 11);
  const names = await harvestNames(ctx);
  await importDatabase(ctx, buildDatabase(names));
  await saveReports(ctx);
  await captureLayout(ctx);
  await captureReports(ctx);
  await captureReportEditor(ctx);
  await captureEditor(ctx);
  await captureTable(ctx);
  await captureDetail(ctx);
  await harvestPanels(ctx);
  await captureViewport(ctx);
}

export const scene = { id: 'f11', run: f11Scene };
