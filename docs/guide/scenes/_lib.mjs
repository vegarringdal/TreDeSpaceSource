// Shared helpers for the user-guide scenes (docs/guide/scenes/*.mjs). Files
// starting with "_" are not scenes. Sample data: the Huldra RVMs in
// convertSamples/rvm.

export const MC = '/src/components/panels/multi-color/multiColor.actions.ts';
export const LABELS = '/src/state/viewer/labels.actions.ts';
export const VIEWER = '/src/state/viewer/viewer.actions.ts';

/** The disciplines every scene loads (small files — the whole set cooks in
 *  seconds). Not HA-INST: it has a part near the origin, ~300 m from the
 *  platform, so a fit-to-visible frames the plant as a speck. */
export const SAMPLES = ['HA-PIPE', 'HA-MECH', 'HA-HVAC', 'HA-SAFE', 'HA-TELE'];

/** Wide enough that no panel row wraps or clips. */
export const PANEL_W = 420;

/** Public-address loudspeakers under /HA-TELE/HA-TELE-PA — close together, so one view frames them all. */
export const SPEAKERS = ['/SX-HA86-011A', '/SX-HA86-012A', '/SX-HA86-013A', '/SX-HA86-014A', '/SX-HA86-015A'];

// -----------------------------------------------------------------------------
// shared helpers
// -----------------------------------------------------------------------------

/** A Set Color rule in the panel's saved-file shape. */
export function rule(comment, filters, { color = null, opacity = 1, enabled = true } = {}) {
  return {
    comment,
    enabled,
    color,
    opacity,
    store: '',
    filters: filters.map((f) => ({ op: 'append', mode: 'contains', comment: '', level: 0, ...f })),
  };
}

/** Load a rule set into the global Set Color panel (same path as Load…),
 *  starting from an untouched model. */
export async function setRules(ctx, mode, rules) {
  await ctx.call(VIEWER, 'viewerActions', 'clearAllOverrides');
  await ctx.call(MC, 'multiColorActions', 'loadFromText', JSON.stringify({ version: 1, mode, rules }));
  await ctx.sleep(300);
}

/** Pick option `text` from the Select whose trigger has tooltip prefix `tooltip`. */
export async function choose(ctx, panel, tooltip, text) {
  await ctx.click({ panel, tooltip });
  await ctx.click({ within: '[role="listbox"]', text });
}

/** Frame whatever is visible now. The import-time fit goes stale (the panel
 *  is widened afterwards), so every 3D shot frames its own view. */
export async function fitView(ctx) {
  await ctx.call(VIEWER, 'viewerActions', 'fitVisible', { wait: ctx.hasGpu });
}

export async function flyTo(ctx, fullname) {
  await ctx.call(VIEWER, 'viewerActions', 'flyToFullname', fullname, { wait: ctx.hasGpu });
}


/** Apply app layout F<n> (1-12) — the same as pressing the F-key. */
export async function layout(ctx, n) {
  await ctx.call('/src/state/layouts.state.ts', 'layoutsActions', 'activate', n - 1);
  await ctx.sleep(600);
}

/** Element spec for the whole dock stack (tab strip + body) that hosts panel
 *  `id` — the box to mark a panel with on a full-screen layout picture. A
 *  minimised panel has no body; mark its tab instead:
 *  { css: '.dock-tab[data-tab="console"]' }. */
export const stack = (id) => ({ css: `section.dock-tabs:has(.dock-panel[data-panel="${id}"])` });

/** Select one item by fullname, as a tree click would. */
export async function select(ctx, fullname) {
  await ctx.call(VIEWER, 'viewerActions', 'select', fullname);
  await ctx.sleep(400);
}
