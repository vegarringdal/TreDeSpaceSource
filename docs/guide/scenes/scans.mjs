// Guide scene: the Scans panel (panel-scans.html) — a laser scan imported
// through the Import Manager, then the panel's three sections and the 3D view
// from outside and from inside a setup.
//
// The scan is NOT in the repo (scans are hundreds of MB and third-party): the
// scene reads SCAN_FILE from $SCAN_SAMPLES, or else from the user's download
// folder. Without the file the scene is skipped and its committed pictures
// stay as they are.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fitView, layout, PANEL_W, stageImport, waitDialog, waitImportIdle } from './_lib.mjs';

/** The user's download folder: what the desktop says it is (it has another
 *  name on a non-English system), else ~/Downloads. */
function downloadDir() {
  try {
    const dir = execFileSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (dir && dir !== homedir()) {
      return dir;
    }
  } catch {
    // no xdg-user-dir (macOS, Windows, a bare container): the usual name
  }

  return resolve(homedir(), 'Downloads');
}

const SCAN_DIR = process.env.SCAN_SAMPLES ?? downloadDir();
/** A small indoor scan with panorama photos: converts in well under a minute. */
const SCAN_FILE = 'BLK360G1_Indoor_Office_classified 1.lgsx';
const SCAN_PATH = resolve(SCAN_DIR, SCAN_FILE);
/** The name the scan is shown under in the pictures. */
const SHOWN_NAME = 'Office.lgsx';

const SCANS = '/src/state/scans/scans.actions.ts';
const SC = { panel: 'scans' };
const IMPORT = { panel: 'importManager', section: 'Import LGSX / E57' };
const POINTS = { ...SC, section: 'Point cloud' };
const PHOTO = { ...SC, section: 'Photo' };
const LIST = { ...SC, section: 'Scans and setups' };

const SCAN_IMPORT_TIMEOUT_MS = 600000;
const ENTER_TIMEOUT_MS = 60000;
const BLEND_OPACITY = 50;
const FULL_OPACITY = 100;

// -----------------------------------------------------------------------------
// local helpers
// -----------------------------------------------------------------------------

/** Show exactly one of the panel's sections, so its picture is never cut off
 *  by the panel's own scrolling. */
async function showOnly(ctx, title) {
  for (const s of ['Point cloud', 'Photo', 'Scans and setups']) {
    await ctx.section('scans', s, s === title);
  }
}

/** The first setup that has a photo (falls back to the first setup). */
async function photoSetup(ctx) {
  return ctx.eval(async () => {
    const { scansState } = await import('/src/state/scans/scans.state.ts');
    const { setups } = scansState.get();
    return (setups.find((s) => s.hasPanorama) ?? setups[0])?.key ?? null;
  });
}

/**
 * Step into a setup; resolves once its photo is decoded and shown. Headless
 * Chrome cannot upload a photo to its software GPU, so there the scene goes on
 * from outside the setup: the pictures that show the "inside" state are marked
 * gpu: 'prefer' and get replaced by the first run on a real GPU.
 */
async function enterSetup(ctx, key) {
  const entered = await Promise.race([
    ctx.call(SCANS, 'scansActions', 'enter', key),
    ctx.sleep(ENTER_TIMEOUT_MS).then(() => ({ error: { msg: 'the photo did not load in time' } })),
  ]);
  if (entered.error && ctx.hasGpu) {
    throw new Error(`docs-shots: could not enter the setup — ${entered.error.msg}`);
  }
  if (entered.error) {
    console.log('  - not inside a setup (no photo upload headless) — panel pictures show the outside state');
    await ctx.call(SCANS, 'scansActions', 'select', key);
  }
  await ctx.sleep(600);
}

/** The exact-count tooltip on a scan file's header (it starts with the
 *  sample's own point count, so it is read from the page). */
async function sizeTooltip(ctx) {
  const el = await ctx.handle({ ...LIST, css: 'span[data-tooltip*=" points, "]' });
  return el.evaluate((e) => e.dataset.tooltip);
}

// -----------------------------------------------------------------------------
// steps
// -----------------------------------------------------------------------------

/** Task: import a scan through the Import Manager (kept for the session only,
 *  so it is loaded as soon as it is converted). */
async function importScan(ctx) {
  await layout(ctx, 13);
  await ctx.widen('importManager', PANEL_W);
  await stageImport(ctx, IMPORT.section, [{ path: SCAN_PATH, name: SHOWN_NAME }]);
  await ctx.shot('scans-import', {
    crop: { el: IMPORT },
    marks: [
      { n: 1, el: { ...IMPORT, text: 'Select LGSX / E57 file(s)…' } },
      { n: 2, el: { ...IMPORT, text: 'Panorama photos' } },
      { n: 3, el: { ...IMPORT, text: '16-bit intensity' } },
      { n: 4, el: { ...IMPORT, text: 'Full fingerprint' } },
      { n: 5, el: { ...IMPORT, tooltip: 'Sub-workers converting' } },
      { n: 6, el: { ...IMPORT, tooltip: 'Cook the scan(s)' } },
    ],
  });
  await ctx.click({ ...IMPORT, tooltip: 'Cook the scan(s)' });
  await waitDialog(ctx);
  await ctx.shot('scans-progress', { crop: { el: { css: '[role="dialog"]' }, pad: 10 } });
  await waitImportIdle(ctx, SCAN_IMPORT_TIMEOUT_MS);
}

/** The Point cloud section and the cloud seen from outside. */
async function capturePoints(ctx) {
  await showOnly(ctx, 'Point cloud');
  await ctx.shot('scans-points', {
    crop: { el: POINTS },
    marks: [
      { n: 1, el: { ...POINTS, text: 'Show points' } },
      { n: 2, el: { ...POINTS, text: 'Colour' } },
      { n: 3, el: { ...POINTS, tooltip: 'Point size on screen' } },
      { n: 4, el: { ...POINTS, tooltip: 'Most points drawn at once' } },
      { n: 5, el: { ...POINTS, tooltip: 'How fine the points are loaded' } },
      { n: 6, el: { ...POINTS, tooltip: 'Points farther from the camera' } },
      { n: 7, el: { ...POINTS, tooltip: 'Full detail within' } },
      { n: 8, el: { ...POINTS, tooltip: 'Points kept in memory' } },
      { n: 9, el: { ...POINTS, text: 'Budget counts points in view only' } },
      { n: 10, el: { ...POINTS, text: 'Adaptive size (fill gaps up close)' } },
      { n: 11, el: { ...POINTS, text: 'Only the entered setup’s points' } },
      { n: 12, el: { ...POINTS, tooltip: 'In view: what the budget counts' }, at: 'tr' },
    ],
  });
  await fitView(ctx);
  await ctx.shot('scans-points-viewport', { crop: 'viewport', gpu: true });
}

/** The Photo section, and the view from inside a setup: the photo alone, then
 *  blended with the points. */
async function capturePhoto(ctx) {
  const key = await photoSetup(ctx);
  if (!key) {
    throw new Error('docs-shots: the scan has no setups');
  }
  await showOnly(ctx, 'Photo');
  await enterSetup(ctx, key);
  await ctx.shot('scans-photo', {
    gpu: 'prefer',
    crop: { el: PHOTO },
    marks: [
      { n: 1, el: { ...PHOTO, text: 'Enter' } },
      { n: 2, el: { ...PHOTO, text: 'Exit' } },
      { n: 3, el: { ...PHOTO, css: '[data-shortcut="scans.prev"]' } },
      { n: 4, el: { ...PHOTO, css: '[data-shortcut="scans.next"]' }, at: 'tr' },
      { n: 5, el: { ...PHOTO, text: 'Over all' } },
      { n: 6, el: { ...PHOTO, tooltip: 'Photo opacity' } },
      { n: 7, el: { ...PHOTO, text: 'Show setup markers' } },
      { n: 8, el: { ...PHOTO, tooltip: 'Opacity of the setup marker' } },
    ],
  });
  await ctx.shot('scans-photo-viewport', { crop: 'viewport', gpu: true });
  await ctx.call(SCANS, 'scansActions', 'setOpacity', BLEND_OPACITY);
  await ctx.shot('scans-blend-viewport', { crop: 'viewport', gpu: true });
  await ctx.call(SCANS, 'scansActions', 'setOpacity', FULL_OPACITY);
}

/** The Scans and setups section, still inside the setup so one row reads
 *  "inside". */
async function captureList(ctx) {
  await showOnly(ctx, 'Scans and setups');
  await ctx.shot('scans-list', {
    gpu: 'prefer',
    // the section fills the panel: crop to what it holds, not to the empty rest
    crop: { union: [{ ...LIST, text: 'Scans and setups' }, { ...LIST, tooltip: 'Fold every scan file' }, { ...LIST, css: '[role="listbox"]' }], pad: 14 },
    marks: [
      { n: 1, el: { ...LIST, tooltip: 'How far one' } },
      { n: 2, el: { ...LIST, tooltip: 'Open every scan file' } },
      { n: 3, el: { ...LIST, tooltip: 'Fold every scan file' }, at: 'tr' },
      { n: 4, el: { ...LIST, css: 'span[data-tooltip*=" points, "]' }, at: 'bl' },
      { n: 5, el: { ...LIST, tooltip: 'On — click to hide' } },
      { n: 6, el: { ...LIST, tooltip: 'Remove this scan' }, at: 'tr' },
      { n: 7, el: { ...LIST, css: '.\\@container' } },
      { n: 8, el: { ...LIST, css: '[role="listbox"]' } },
    ],
  });
  await ctx.call(SCANS, 'scansActions', 'exit');
  await ctx.sleep(600);
}

// -----------------------------------------------------------------------------
// scene
// -----------------------------------------------------------------------------

async function scansScene(ctx) {
  await importScan(ctx);
  await layout(ctx, 1);
  await ctx.open('scans');
  await ctx.widen('scans', PANEL_W);

  await capturePoints(ctx);
  await capturePhoto(ctx);
  await captureList(ctx);

  for (const s of ['Point cloud', 'Photo', 'Scans and setups']) {
    await ctx.section('scans', s, true);
  }
  await ctx.harvest('scans', {
    rename: {
      'Point size on screen': 'Size',
      'Shrink the scan points': 'Size −',
      'Grow the scan points by': 'Size +',
      'Most points drawn at once': 'Budget',
      'Draw up to 1 million fewer': 'Budget −',
      'Draw up to 1 million more': 'Budget +',
      'How fine the points are loaded': 'Detail',
      'Load the scan points coarser': 'Detail −',
      'Load the scan points finer': 'Detail +',
      'Points farther from the camera': 'Max dist',
      'Lower the max distance': 'Max dist −',
      'Raise the max distance': 'Max dist +',
      'Full detail within': 'Focus',
      'Lower the distance within': 'Focus −',
      'Raise the distance within': 'Focus +',
      'Points kept in memory': 'Cache',
      'Keep 25 % fewer': 'Cache −',
      'Keep 25 % more': 'Cache +',
      'In view: what the budget counts': 'Points drawn',
      'Select the previous setup': 'Previous setup',
      'Select the next setup': 'Next setup',
      'Photo opacity': 'Opacity',
      'Lower the panorama opacity': 'Opacity −',
      'Raise the panorama opacity': 'Opacity +',
      'Opacity of the setup marker': 'Markers',
      'Lower the opacity of the setup marker': 'Markers −',
      'Raise the opacity of the setup marker': 'Markers +',
      'How far one': 'Offset step',
      'Make one − / + of the scan offset boxes move less': 'Offset step −',
      'Make one − / + of the scan offset boxes move further': 'Offset step +',
      'Open every scan file': 'Open all',
      'Fold every scan file': 'Fold all',
      'On — click to hide': 'Scan on / off',
      'Remove this scan': 'Remove scan',
      'Offset along X': 'X',
      'Offset along Y': 'Y',
      'Offset along Z': 'Z',
      'Move the current scan − one offset step along X': 'X −',
      'Move the current scan + one offset step along X': 'X +',
      'Move the current scan − one offset step along Y': 'Y −',
      'Move the current scan + one offset step along Y': 'Y +',
      'Move the current scan − one offset step along Z': 'Z −',
      'Move the current scan + one offset step along Z': 'Z +',
    },
    // every scan file is a section named after the file
    sectionAlias: { [`^${SHOWN_NAME.replace(/\.[^.]+$/, '')}$`]: 'Scan file' },
    skip: ['About scans', 'Offset in metres: moves this scan', 'Double-click to enter', await sizeTooltip(ctx)],
    extra: [
      {
        section: 'Scan file',
        first: true,
        label: 'Name',
        tooltip: 'Click to fold the scan file away or open it. Grey while the scan is switched off.',
      },
      {
        section: 'Scan file',
        label: 'Points · setups',
        tooltip: 'On the right of the name: how many points and setups the scan has. Hover for the exact number.',
      },
      {
        section: 'Scan file',
        label: 'Coords',
        tooltip:
          'Shown when the scan stores coordinate systems: the one the scan is shown in. Switching is instant and remembered for the scan.',
        keys: 'ALT 1748',
      },
      {
        section: 'Scan file',
        label: 'Setup row',
        tooltip: 'Click selects the setup, double-click enters it. A faint icon means the setup has no photo.',
      },
    ],
  });
}

/** Skipped where the sample scan is not on this machine. */
function skip() {
  return existsSync(SCAN_PATH) ? null : `sample scan not found: ${SCAN_PATH} (put it in the download folder, or set SCAN_SAMPLES to its folder)`;
}

export const scene = { id: 'scans', run: scansScene, skip };
