// Guide scene: the Settings panel (panel-settings.html) — one picture per
// vertical tab plus a reference table per tab (harvest `key`). Settings →
// Layouts reuses the start page's layout-settings-tab picture.
import { layout, PANEL_W, SAMPLES } from './_lib.mjs';

const ST = { panel: 'settings' };
const SETTINGS_STATE = '/src/components/panels/settings/settings.state.ts';

/** The panel's own Save… / Load… / Reset all buttons — on every tab, so they
 *  are left out of the per-tab tables (the page lists them once). */
const PANEL_BUTTONS = ['Save every setting', 'Load a settings JSON', 'Reset Rendering, Lighting'];

// -----------------------------------------------------------------------------
// local helpers
// -----------------------------------------------------------------------------

async function showTab(ctx, id) {
  await ctx.call(SETTINGS_STATE, 'settingsTabState', 'set', { tab: id });
  await ctx.sleep(400);
}

/** Scroll the tab content so section `title` starts at the top. */
async function scrollTo(ctx, title) {
  await ctx.eval((t) => {
    const root = document.querySelector('.dock-panel[data-panel="settings"]');
    window.__doc.sectionOf(root, t)?.scrollIntoView({ block: 'start' });
  }, title);
  await ctx.sleep(300);
}

/** Fold every open section of the current tab. */
async function collapseAll(ctx) {
  await ctx.eval(() => {
    const root = document.querySelector('.dock-panel[data-panel="settings"]');
    for (const btn of root.querySelectorAll('button[aria-expanded="true"]')) {
      btn.click();
    }
  });
  await ctx.sleep(300);
}

/**
 * Readable labels for the harvested rows of the current tab. Number fields
 * render their − / + steppers (and a field tooltip) without the field's name,
 * and radio options / checkboxes append their hint after a dash — so each row
 * is renamed from its field label. The per-section reset buttons are skipped
 * (one note on the page explains them). Longer descriptions come first so a
 * prefix match never picks a shorter look-alike.
 */
async function tabLabels(ctx) {
  const pairs = await ctx.eval(async () => {
    const { hotkeysActions } = await import('/src/treDeSpaceUI/hotkeys/index.ts');
    const root = document.querySelector('.dock-panel[data-panel="settings"]');
    const rename = [];
    const skip = [];
    for (const el of root.querySelectorAll('[data-tooltip],[data-shortcut]')) {
      const shortcut = el.dataset.shortcut ?? '';
      const desc = el.dataset.tooltip || (shortcut ? (hotkeysActions.describe(shortcut) ?? '') : '');
      if (!desc) {
        continue;
      }
      if (shortcut.startsWith('settings.reset.')) {
        skip.push(desc);
        continue;
      }
      const text = el.textContent.trim();
      const field = el.closest('label')?.querySelector(':scope > span')?.textContent.trim();
      let label = null;
      if ((text === '−' || text === '+') && field) {
        label = `${field} ${text}`;
      } else if (/^[−+]+$/.test(text) && field) {
        label = field;
      } else if (text.includes('—')) {
        label = text.split('—')[0].trim();
      }
      if (label && label !== text) {
        rename.push([desc, label]);
      }
    }
    return { rename, skip };
  });
  pairs.rename.sort((a, b) => b[0].length - a[0].length);
  return { rename: Object.fromEntries(pairs.rename), skip: pairs.skip };
}

async function harvestTab(ctx, id, { extra = [], section = '' } = {}) {
  const { rename, skip } = await tabLabels(ctx);
  await ctx.harvest('settings', {
    key: `settings-${id}`,
    rename: { ...rename, 'Show this row in the viewport overlay': 'Row tick boxes' },
    sectionAlias: { '': section },
    skip: [...skip, ...PANEL_BUTTONS],
    extra,
  });
}

/** The tab strip plus the current tab's content down to `last` — the empty
 *  panel below a short tab is left out. */
const TAB_COUNT = 13;
const tabCrop = (last) => ({
  union: [{ ...ST, css: '[role="tab"]', nth: 0 }, { ...ST, css: '[role="tab"]', nth: TAB_COUNT - 1 }, last],
  pad: 6,
});

// -----------------------------------------------------------------------------
// tabs
// -----------------------------------------------------------------------------

async function captureOverview(ctx) {
  await showTab(ctx, 'rendering');
  await collapseAll(ctx);
  await ctx.shot('settings-overview', {
    crop: { panel: 'settings' },
    marks: [
      { n: 1, el: { ...ST, css: '[role="tablist"]' } },
      { n: 2, el: { ...ST, css: 'button[aria-expanded]', nth: 0 } },
      { n: 3, el: { ...ST, tooltip: 'More info', nth: 0 }, at: 'bl' },
      { n: 4, el: { ...ST, tooltip: 'Antialiasing is at its defaults' }, at: 'tr' },
      { n: 5, el: { ...ST, text: 'Save…' } },
      { n: 6, el: { ...ST, text: 'Load…' } },
      { n: 7, el: { ...ST, text: 'Reset all settings' } },
    ],
  });
}

async function captureRendering(ctx) {
  // leave and come back: the tab re-renders with every section open again
  await showTab(ctx, 'about');
  await showTab(ctx, 'rendering');
  await ctx.shot('settings-rendering-aa', { crop: { el: { ...ST, section: 'Antialiasing' } } });
  await scrollTo(ctx, 'Transparency');
  await ctx.shot('settings-rendering-transparency', { crop: { el: { ...ST, section: 'Transparency' } } });
  await scrollTo(ctx, 'VRAM budget');
  await ctx.shot('settings-rendering-vram', { crop: { el: { ...ST, section: 'VRAM budget' } } });
  await scrollTo(ctx, 'Background & selection');
  await ctx.shot('settings-rendering-selection', { crop: { el: { ...ST, section: 'Background & selection' } } });
  await harvestTab(ctx, 'rendering', {
    section: 'Antialiasing',
    extra: [
      { section: 'Background & selection', label: 'Background', tooltip: 'Colour of the 3D view behind the model.', first: true },
      { section: 'Background & selection', label: 'Selection colour', tooltip: 'Colour of the tint on selected items.' },
    ],
  });
}

async function captureSimpleTabs(ctx) {
  await showTab(ctx, 'lighting');
  await ctx.shot('settings-lighting', { crop: tabCrop({ ...ST, section: 'Sketch lighting' }) });
  await harvestTab(ctx, 'lighting');

  await showTab(ctx, 'gpu');
  await ctx.shot('settings-gpu', { crop: { el: { ...ST, section: 'GPU' } } });
  await harvestTab(ctx, 'gpu');

  await showTab(ctx, 'navigation');
  await ctx.shot('settings-navigation', { crop: { el: { ...ST, section: 'Navigation' } } });
  await harvestTab(ctx, 'navigation', { section: 'Navigation' });

  await showTab(ctx, 'edges');
  await ctx.shot('settings-edges', { crop: { el: { ...ST, section: 'Edges — common' } } });
  await harvestTab(ctx, 'edges');

  await showTab(ctx, 'ao');
  await ctx.shot('settings-ao', { crop: { el: { ...ST, section: 'Ambient Occlusion' } } });
  await harvestTab(ctx, 'ao');

  await showTab(ctx, 'gizmo');
  await ctx.shot('settings-gizmo', { crop: tabCrop({ ...ST, section: 'Cube colours' }) });
}

async function captureShortcuts(ctx) {
  await showTab(ctx, 'shortcuts');
  await ctx.shot('settings-shortcuts', {
    crop: tabCrop({ ...ST, section: 'Camera / navigation' }),
    marks: [
      { n: 1, el: { ...ST, section: 'Import / export' } },
      { n: 2, el: { ...ST, css: 'input[type="search"]' } },
      { n: 3, el: { ...ST, section: 'Camera / navigation' } },
    ],
  });
  await ctx.type({ ...ST, css: 'input[type="search"]' }, 'screenshot');
  await ctx.sleep(300);
  await ctx.click({ ...ST, text: 'Record', nth: 0 });
  await ctx.shot('settings-shortcut-record', {
    crop: { union: [{ ...ST, section: 'Import / export' }, { ...ST, section: 'Camera / navigation' }] },
    marks: [
      { n: 1, el: { ...ST, text: 'press keys… (Esc)' } },
      { n: 2, el: { ...ST, tooltip: 'Default binding', nth: 0 }, at: 'tr' },
      { n: 3, el: { ...ST, text: 'Record', nth: 0 }, at: 'tr' },
    ],
  });
  await ctx.page.keyboard.press('Escape');
  await ctx.sleep(300);
  await ctx.type({ ...ST, css: 'input[type="search"]' }, '');
}

async function captureLastTabs(ctx) {
  await showTab(ctx, 'stats');
  await ctx.shot('settings-stats', { crop: tabCrop({ ...ST, section: 'Stats' }) });
  await harvestTab(ctx, 'stats');

  await showTab(ctx, 'editor');
  await ctx.shot('settings-editor', { crop: { el: { ...ST, section: 'Editor' } } });
  await harvestTab(ctx, 'editor');

  await showTab(ctx, 'external');
  await ctx.shot('settings-external', { crop: tabCrop({ ...ST, section: 'API security' }) });
  await harvestTab(ctx, 'external');

  await showTab(ctx, 'about');
  await ctx.shot('settings-about', { crop: tabCrop({ ...ST, text: 'Show third-party notices' }) });
}

async function settingsScene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 1);
  await ctx.widen('settings', PANEL_W);
  await captureOverview(ctx);
  await captureRendering(ctx);
  await captureSimpleTabs(ctx);
  await captureShortcuts(ctx);
  await captureLastTabs(ctx);
}

export const scene = { id: 'settings', run: settingsScene };
