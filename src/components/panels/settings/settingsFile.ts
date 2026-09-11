// Settings as one JSON file: the scope "Reset all settings" covers (rendering,
// lighting, GPU, navigation, edges, AO, gizmo, stats, editor, theme) plus the
// colour-picker swatches and the custom keyboard shortcuts. Layout slots and
// External apps are user content, not preferences — they stay out, exactly as
// they do for Reset all.
import { hotkeysActions } from '@treDeSpaceUI/hotkeys';
import { downloadText } from '../../../lib/download';
import { DEFAULT_PICKER_SWATCHES, pickerSwatchesState } from '../../../state/pickerSwatches.state';
import { gizmoLabelsActions, gizmoLabelsState, mergeGizmoLabels } from '../../../state/viewer/gizmoLabels.state';
import { NAV_DEFAULTS, type NavState, navState } from '../../../state/viewer/nav.state';
import { initialViewerState, type ViewerState, viewerState } from '../../../state/viewer/viewer.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import { initTheme } from './settings.actions';
import { SETTINGS_DEFAULTS, type SettingsState, settingsState } from './settings.state';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

type ErrorResult = Readonly<{ err: unknown; msg: string }>;
type Result<T> = Readonly<{ data?: T; error?: ErrorResult }>;

const FILE_VERSION = 1;
const FILE_NAME = 'tredespace-settings.json';
/** Per-session view state and worker-reported flags — never part of a file. */
const VIEWER_TRANSIENT: readonly (keyof ViewerState)[] = [
  'hasTransparency',
  'suppressTintOnOverride',
  'orthographic',
  'sketch',
];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The keys of `obj` that `defaults` knows (unknown keys from a foreign or
 *  newer file are dropped instead of leaking into the store). */
function knownKeys(
  defaults: object,
  obj: Record<string, unknown>,
  skip: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(defaults)) {
    if (k in obj && !skip.includes(k)) {
      out[k] = obj[k];
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// save
// -----------------------------------------------------------------------------

export function settingsToJson(): string {
  const viewer: Record<string, unknown> = knownKeys(initialViewerState, { ...viewerState.get() }, VIEWER_TRANSIENT);
  return JSON.stringify(
    {
      version: FILE_VERSION,
      viewer,
      nav: navState.get(),
      gizmoLabels: gizmoLabelsState.get().labels,
      settings: settingsState.get(),
      pickerSwatches: pickerSwatchesState.get().colors,
      shortcuts: JSON.parse(hotkeysActions.exportJson()) as unknown,
    },
    null,
    2,
  );
}

export function saveSettingsFile(): void {
  downloadText(FILE_NAME, settingsToJson());
  consoleActions.log('info', `Settings → saved ${FILE_NAME}`);
}

// -----------------------------------------------------------------------------
// load
// -----------------------------------------------------------------------------

/** Apply a settings file. Tolerant: every block is optional and is merged
 *  over that store's defaults, so an older or partial file still applies;
 *  values are trusted like the localStorage copies are. Returns the blocks
 *  that were applied. */
export function applySettingsJson(text: string): Result<{ applied: string[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: { err, msg: 'The file is not valid JSON.' } };
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    return { error: { err: null, msg: 'Not a TreDeSpace settings file (missing version).' } };
  }
  const applied: string[] = [];
  if (isRecord(parsed.viewer)) {
    const cur = viewerState.get();
    const patch = knownKeys(initialViewerState, parsed.viewer, VIEWER_TRANSIENT) as Partial<ViewerState>;
    viewerState.set({ ...initialViewerState, ...patch, ...pickTransient(cur) });
    applied.push('viewer');
  }
  if (isRecord(parsed.nav)) {
    navState.set({ ...NAV_DEFAULTS, ...(knownKeys(NAV_DEFAULTS, parsed.nav) as Partial<NavState>) });
    applied.push('navigation');
  }
  if (isRecord(parsed.gizmoLabels)) {
    gizmoLabelsActions.setAll(mergeGizmoLabels(parsed.gizmoLabels));
    applied.push('gizmo labels');
  }
  if (isRecord(parsed.settings)) {
    settingsState.set({
      ...SETTINGS_DEFAULTS,
      ...(knownKeys(SETTINGS_DEFAULTS, parsed.settings) as Partial<SettingsState>),
    });
    initTheme();
    applied.push('editor + theme + GPU');
  }
  if (Array.isArray(parsed.pickerSwatches)) {
    const list: unknown[] = parsed.pickerSwatches;
    pickerSwatchesState.set({
      colors: DEFAULT_PICKER_SWATCHES.map((d, i) => {
        const c = list[i];
        return typeof c === 'string' ? c : d;
      }),
    });
    applied.push('swatches');
  }
  if (isRecord(parsed.shortcuts)) {
    hotkeysActions.resetAll();
    try {
      hotkeysActions.importJson(JSON.stringify(parsed.shortcuts));
      applied.push('shortcuts');
    } catch (err) {
      return { error: { err, msg: `Shortcuts block rejected: ${err instanceof Error ? err.message : String(err)}` } };
    }
  }
  return { data: { applied } };
}

function pickTransient(s: ViewerState): Partial<ViewerState> {
  return {
    hasTransparency: s.hasTransparency,
    suppressTintOnOverride: s.suppressTintOnOverride,
    orthographic: s.orthographic,
    sketch: s.sketch,
  };
}

/** Open a file picker and apply the chosen settings file (button + hotkey —
 *  a transient input so no component needs to host one). */
export function loadSettingsFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((text) => {
      const r = applySettingsJson(text);
      if (r.error) {
        dialogs.error(r.error.msg, 'Load settings');
        return;
      }
      consoleActions.log('info', `Settings → loaded ${file.name} (${r.data?.applied.join(', ') || 'nothing'})`);
    });
  };
  input.click();
}
