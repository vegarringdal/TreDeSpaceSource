// Per-section reset for the Settings panel: every collapsible section names
// the state it owns, so its header reset button can grey out while the
// section already equals its defaults, and reset exactly that state and
// nothing else. The hotkey table generates one `settings.reset.<id>` per
// entry from the same list.
import { hotkeysActions, hotkeysState } from '@treDeSpaceUI/hotkeys';
import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_PICKER_SWATCHES,
  pickerSwatchesActions,
  pickerSwatchesState,
} from '../../../state/pickerSwatches.state';
import { DEFAULT_GIZMO_LABELS, gizmoLabelsActions, gizmoLabelsState } from '../../../state/viewer/gizmoLabels.state';
import { NAV_DEFAULTS, navActions, navState } from '../../../state/viewer/nav.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { initialViewerState, type ViewerState, viewerState } from '../../../state/viewer/viewer.state';
import { consoleActions } from '../console/console.actions';
import { settingsActions } from './settings.actions';
import { SETTINGS_DEFAULTS, settingsState } from './settings.state';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type Subscribable = Readonly<{ subscribe(fn: () => void): () => void }>;

interface SectionDef {
  /** Name used in tooltips, hotkey labels and the console line. */
  label: string;
  /** Stores whose changes can flip `isDirty` — the header button subscribes to them. */
  stores: readonly Subscribable[];
  isDirty(): boolean;
  reset(): void;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Any key of `defaults` whose value differs in `state` (extra keys ignored). */
function differs(state: object, defaults: object): boolean {
  const s: Record<string, unknown> = { ...state };
  const d: Record<string, unknown> = { ...defaults };
  return Object.keys(d).some((k) => !same(s[k], d[k]));
}

function pickDefaults<T extends object, K extends keyof T>(defaults: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    out[k] = defaults[k];
  }
  return out;
}

/** A section made of viewer-state keys only (the common case). */
function viewerSection(label: string, keys: readonly (keyof ViewerState)[]): SectionDef {
  return {
    label,
    stores: [viewerState],
    isDirty: () => keys.some((k) => !same(viewerState.get()[k], initialViewerState[k])),
    reset: () => viewerActions.update(pickDefaults(initialViewerState, keys)),
  };
}

// -----------------------------------------------------------------------------
// the sections
// -----------------------------------------------------------------------------

export const SETTINGS_SECTIONS = {
  antialiasing: viewerSection('Antialiasing', [
    'fastAA',
    'aaSamples',
    'msaa4x',
    'pixelRatio',
    'useDevicePixelRatio',
    'smartPixelRatio',
  ]),
  culling: viewerSection('Culling', ['fpsLimit', 'freezeCull', 'protectDist', 'pxCut', 'pxCutEnabled', 'vertexPull']),
  picking: viewerSection('Picking', ['pickOpacityPct']),
  vramBudget: viewerSection('VRAM budget', [
    'vramBudgetOn',
    'maxVramMb',
    'vramSwapSpeed',
    'vramDebugBoxes',
    'vramCutSizeM',
    'vramCutDistM',
    'vramDropHidden',
    'vramActivityHud',
    'vramHoldAccum',
  ]),
  selection: viewerSection('Background & selection', ['bgColor', 'selectionColor', 'selectionStyle']),
  outline: viewerSection('Outline', [
    'outlineHover',
    'outlineStrength',
    'outlineGlow',
    'outlineThickness',
    'outlinePulse',
    'outlineVisibleColor',
    'outlineHiddenColor',
  ]),
  transparency: viewerSection('Transparency', ['transparencyBlend', 'transparencyBackdrop', 'backdropFadePct']),
  darkColors: viewerSection('Dark colours', ['darkLift', 'darkLiftPct']),
  debug: viewerSection('Debug', ['meshletVis', 'debugBuf']),
  lighting: viewerSection('Lighting', ['ambientColor', 'ambientIntensity', 'headlightColor', 'headlightIntensity']),
  sketchLighting: viewerSection('Sketch lighting', [
    'sketchAmbientColor',
    'sketchAmbientIntensity',
    'sketchHeadlightColor',
    'sketchHeadlightIntensity',
  ]),
  edgesCommon: viewerSection('Edges — common', ['geoEdges', 'itemEdges', 'edgeColor', 'whiteOnDark', 'darkThr']),
  edgesFlat: viewerSection('Edges — flat shading', ['flatMeshEdges', 'fadeExp', 'depthThr', 'normalThr']),
  edgesSmooth: viewerSection('Edges — with normals', [
    'smoothMeshEdges',
    'smoothFadeExp',
    'smoothDepthThr',
    'smoothNormalThr',
  ]),
  sketchEdges: viewerSection('Sketch edges', [
    'sketchEdgeColor',
    'sketchFadeExp',
    'sketchDepthThr',
    'sketchNormalThr',
    'sketchRespectsEdgesOff',
    'sketchColorMode',
    'sketchCubeFaceColor',
    'sketchCubeLineColor',
    'sketchCubeTextColor',
    'sketchCubeHoverColor',
  ]),
  ao: viewerSection('Ambient Occlusion', ['aoMode', 'aoRadius', 'aoStrength', 'aoSlices', 'aoSamples']),
  cubeColors: viewerSection('Cube colours', ['cubeFaceColor', 'cubeLineColor', 'cubeTextColor', 'cubeHoverColor']),
  stats: viewerSection('Stats', ['showStats', 'statsHidden', 'statsBackdrop', 'gpuTimings', 'trace']),
  navigation: {
    label: 'Navigation',
    stores: [navState, viewerState],
    isDirty: () => differs(navState.get(), NAV_DEFAULTS) || viewerState.get().fitDense !== initialViewerState.fitDense,
    reset: () => {
      navActions.reset();
      viewerActions.update({ fitDense: initialViewerState.fitDense });
    },
  },
  gizmoNames: {
    label: 'Gizmo',
    stores: [gizmoLabelsState],
    isDirty: () => differs(gizmoLabelsState.get().labels, DEFAULT_GIZMO_LABELS),
    reset: () => gizmoLabelsActions.reset(),
  },
  gpu: {
    label: 'GPU',
    stores: [settingsState],
    isDirty: () => settingsState.get().gpu !== SETTINGS_DEFAULTS.gpu,
    reset: () => settingsActions.setGpu(SETTINGS_DEFAULTS.gpu),
  },
  editor: {
    label: 'Editor',
    stores: [settingsState, pickerSwatchesState],
    isDirty: () =>
      settingsState.get().theme !== SETTINGS_DEFAULTS.theme ||
      !same(pickerSwatchesState.get().colors, DEFAULT_PICKER_SWATCHES),
    reset: () => {
      settingsActions.setTheme(SETTINGS_DEFAULTS.theme);
      pickerSwatchesActions.reset();
    },
  },
  shortcuts: {
    label: 'Shortcuts',
    stores: [hotkeysState],
    isDirty: () => Object.keys(hotkeysState.get().overrides).length > 0,
    reset: () => hotkeysActions.resetAll(),
  },
} satisfies Record<string, SectionDef>;

export type SettingsSectionId = keyof typeof SETTINGS_SECTIONS;

/** Every section id, in panel order — the hotkey table maps over this. */
export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = Object.keys(SETTINGS_SECTIONS).filter(
  (k): k is SettingsSectionId => k in SETTINGS_SECTIONS,
);

// -----------------------------------------------------------------------------
// actions + hook
// -----------------------------------------------------------------------------

/** Reset one section to its defaults (header button + `settings.reset.<id>`). */
export function resetSection(id: SettingsSectionId): void {
  const def = SETTINGS_SECTIONS[id];
  def.reset();
  consoleActions.log('info', `Settings → ${def.label} reset to defaults`);
}

/** True while the section differs from its defaults — subscribed to every
 *  store the section reads, so the header button updates live. */
export function useSectionDirty(id: SettingsSectionId): boolean {
  const def = SETTINGS_SECTIONS[id];
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = def.stores.map((s) => s.subscribe(cb));
      return () => {
        for (const off of offs) {
          off();
        }
      };
    },
    [def],
  );
  return useSyncExternalStore(subscribe, def.isDirty);
}
