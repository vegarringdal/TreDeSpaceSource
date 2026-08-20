// Viewpoints: capture / activate / mute-swap / persistence. See
// viewpoints.state.ts for the data model and the scene↔viewpoint mute design.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { makeMultiColorActions } from '../../components/panels/multi-color/multiColor.actions';
import {
  type ColorRule,
  isPristineRuleSet,
  multiColorState,
  normalizeRules,
} from '../../components/panels/multi-color/multiColor.state';
import { ribbonClippingBoxState } from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.state';
import { ribbonClippingPlaneState } from '../../components/panels/ribbon-clipping-plane/ribbonClippingPlane.state';
import { downloadText } from '../../lib/download';
// transport directly (not the messageApi index) — the index imports the
// handlers, which import this module: going through it would be a cycle
import { emitApiEvent } from '../../lib/messageApi/transport';
import { clipShapesActions } from './clipShapes.actions';
import { clipShapesState } from './clipShapes.state';
import { db } from './db';
import { labelsActions } from './labels.actions';
import { labelsState, type SceneLabel } from './labels.state';
import { type Measurement, measurementsState } from './measurements.state';
import { selectionState } from './selection.state';
import { getRenderer, viewerActions } from './viewer.actions';
import { viewerState } from './viewer.state';
import {
  type Viewpoint,
  type ViewpointCamera,
  type ViewpointClipBox,
  viewpointRulesState,
  viewpointsState,
} from './viewpoints.state';

const clone = <T>(v: T): T => structuredClone(v);

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The active viewpoint's Set Color actions (bound to viewpointRulesState).
 *  Edits stay in the editor store until "Save to viewpoint" commits them —
 *  nothing auto-saves into the viewpoint record. */
export const viewpointRulesActions = makeMultiColorActions(viewpointRulesState);

function loadRulesFromViewpoint(vp: Viewpoint) {
  viewpointRulesState.set({ mode: vp.colorRules.mode, rules: clone(vp.colorRules.rules), counts: [], running: false });
}

/** True when the viewpoint Set Color editor differs from the saved record. */
export function viewpointRulesDirty(vp: Viewpoint): boolean {
  const { mode, rules } = viewpointRulesState.get();
  return JSON.stringify({ mode, rules }) !== JSON.stringify(vp.colorRules);
}

/** Labels compared WITHOUT volatile fields: setAll re-bases `id` and clears
 *  `selected` on every viewpoint swap, so comparing them raw would flag every
 *  freshly activated viewpoint as dirty. */
const labelContent = (items: SceneLabel[]) =>
  JSON.stringify(items.map(({ id: _id, selected: _selected, ...rest }) => rest));

/** True when the live labels/measurements differ from the saved record (only
 *  meaningful while the viewpoint side is live). */
export function viewpointSetsDirty(vp: Viewpoint): boolean {
  return (
    labelContent(labelsState.get().items) !== labelContent(vp.labels) ||
    JSON.stringify(measurementsState.get().items) !== JSON.stringify(vp.measurements)
  );
}

function patchViewpoint(id: string, patch: Partial<Viewpoint>) {
  viewpointsState.set((s) => ({ list: s.list.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
}

function captureCamera(): ViewpointCamera {
  const r = getRenderer();
  const c = r?.camera;
  return {
    target: c ? [c.target[0], c.target[1], c.target[2]] : [0, 0, 0],
    azimuth: c?.azimuth ?? 0.6,
    elevation: c?.elevation ?? 0.5,
    orbitDistance: c?.orbitDistance ?? 10,
    orthographic: viewerState.get().orthographic,
    sketch: viewerState.get().sketch,
  };
}

function captureClipBox(): ViewpointClipBox {
  const b = ribbonClippingBoxState.get();
  return {
    enabled: b.enabled,
    boxOn: b.boxOn,
    center: [...b.center],
    size: [...b.size],
    rotation: [...b.rotation],
    inverted: b.inverted,
  };
}

/** Replace the live measurement set (viewpoint swap — no file round-trip). */
function setMeasurements(items: Measurement[]) {
  let nextId = 0;
  for (const m of items) {
    nextId = Math.max(nextId, m.id);
  }
  measurementsState.set({ items, inProgress: [], nextId });
}

/** Freshly captured viewpoints copy the global Set Color state — when that
 *  editor was never touched, store NO rules instead of the meaningless
 *  pristine copy. A viewpoint with any rules at all runs them on activation
 *  (a deliberate all-Default rule is a "reset to default colors" and must
 *  run); only a rule-less viewpoint leaves the current colors alone. */
const captureRules = (mode: 'reset' | 'append' | 'hide', rules: ColorRule[]): Viewpoint['colorRules'] => ({
  mode,
  rules: isPristineRuleSet(rules) ? [] : clone(rules),
});

const shouldRunRules = (vp: Viewpoint) => vp.colorRules.rules.some((r) => r.enabled);

export const viewpointsActions = {
  /** Snapshot the camera + clipping into a new viewpoint and ACTIVATE it.
   *  The viewpoint starts EMPTY otherwise: no labels, no measurements, no Set
   *  Color rules — use the "Copy …" buttons to bring content in. Activation
   *  loads the empty sets, so on-screen labels/measurements are removed (the
   *  scene's own sets are stashed and come back on unmute); only Set Color
   *  leaves the current colors alone while the viewpoint has no rules. */
  async addViewpoint() {
    const s = viewpointsState.get();
    const vp: Viewpoint = {
      id: uid(),
      name: `Viewpoint ${s.list.length + 1}`,
      description: '',
      camera: captureCamera(),
      clipBox: captureClipBox(),
      clipPlanes: clone(ribbonClippingPlaneState.get()),
      clipShapes: clone(clipShapesState.get().shapes),
      labels: [],
      measurements: [],
      colorRules: { mode: 'reset', rules: [] },
      fullnames: [],
    };
    viewpointsState.set({ list: [...s.list, vp], selectedId: vp.id });
    consoleActions.log('info', `Viewpoints: added "${vp.name}"`);
    await viewpointsActions.activate(vp.id);
  },

  /** Activate: animated camera + clip + labels/measurements swap + rules run
   *  + fullname selection. The scene's labels/measurements are stashed.
   *  UNSAVED edits to the previously live viewpoint are discarded — edits only
   *  stick via the explicit Save-to-viewpoint button. */
  async activate(id: string) {
    const s = viewpointsState.get();
    if (!s.list.some((v) => v.id === id)) {
      return;
    }
    // unsaved edits on the previously active viewpoint: offer to save them
    await viewpointsActions.confirmUnsavedEdits();
    // park the scene sets (a previously live viewpoint's edits were handled)
    if (viewpointsState.get().liveSide !== 'viewpoint') {
      viewpointsState.set({
        stash: { labels: clone(labelsState.get().items), measurements: clone(measurementsState.get().items) },
      });
    }
    const vp = viewpointsState.get().list.find((v) => v.id === id);
    if (!vp) {
      return;
    }
    labelsActions.setAll(clone(vp.labels));
    setMeasurements(clone(vp.measurements));
    // camera (animated, short way round) + projection + clipping
    getRenderer()?.camera.goToPose(
      [...vp.camera.target],
      vp.camera.azimuth,
      vp.camera.elevation,
      vp.camera.orbitDistance,
      0.5,
    );
    viewerActions.setProjection(vp.camera.orthographic);
    // sketch mode travels with the camera capture (older viewpoints without
    // the field leave the current mode alone)
    if (vp.camera.sketch != null) {
      viewerState.set({ sketch: vp.camera.sketch });
    }
    ribbonClippingBoxState.set(clone(vp.clipBox));
    // clipping planes (viewpoints saved before this field leave them as-is)
    if (vp.clipPlanes) {
      ribbonClippingPlaneState.set(clone(vp.clipPlanes));
    }
    clipShapesActions.importJson(JSON.stringify({ shapes: vp.clipShapes }));
    // the viewpoint's Set Color rules become the editing context; any edited
    // rule set runs — only the pristine untouched default is skipped (in
    // Reset mode it would silently clear the user's colors)
    loadRulesFromViewpoint(vp);
    viewpointsState.set({ activeId: id, selectedId: id, liveSide: 'viewpoint', editing: false });
    if (shouldRunRules(vp)) {
      await viewpointRulesActions.run();
    }
    // empty selection list means SELECT NONE (same as labels/measurements:
    // the viewpoint defines the state; only rule-less Set Color keeps things)
    if (vp.fullnames.length > 0) {
      await viewerActions.selectByFullnames(vp.fullnames);
    } else {
      await viewerActions.clearSelection();
    }
    consoleActions.log('info', `Viewpoints: activated "${vp.name}"`);
  },

  /** The "(viewpoint)" bars' Edit button: enter editing (the bar's button
   *  becomes Save-to-viewpoint, lit once something differs). */
  startEditing() {
    if (viewpointsState.get().activeId) {
      viewpointsState.set({ editing: true });
    }
  },

  /** When the active viewpoint has unsaved edits, ask whether to save them
   *  (Discard leaves the record as it was). Call before switching away. */
  async confirmUnsavedEdits() {
    const s = viewpointsState.get();
    const prev = s.list.find((v) => v.id === s.activeId);
    if (!prev) {
      return;
    }
    const dirty = viewpointRulesDirty(prev) || (s.liveSide === 'viewpoint' && viewpointSetsDirty(prev));
    if (!dirty) {
      return;
    }
    const save = await dialogs.confirm(`"${prev.name}" has unsaved edits. Save them to the viewpoint first?`, {
      title: 'Unsaved viewpoint edits',
      okLabel: 'Save',
      cancelLabel: 'Discard',
    });
    if (save) {
      viewpointsActions.saveLiveToActive();
    }
  },

  /** The Save-to-viewpoint button: commit the viewpoint editors into the
   *  active viewpoint record. Rules always save; labels/measurements save only
   *  while the viewpoint side is live (otherwise the live stores hold the
   *  SCENE's sets). This is the ONLY way edits stick — nothing auto-saves. */
  saveLiveToActive() {
    const { activeId, liveSide } = viewpointsState.get();
    if (!activeId) {
      return;
    }
    const { mode, rules } = viewpointRulesState.get();
    patchViewpoint(activeId, {
      colorRules: { mode, rules: clone(rules) },
      ...(liveSide === 'viewpoint'
        ? {
            labels: clone(labelsState.get().items),
            measurements: clone(measurementsState.get().items),
          }
        : {}),
    });
  },

  /** Unmute the SCENE (mutes the viewpoint editors): the parked scene
   *  labels/measurements come back. Prompts to save unsaved viewpoint edits. */
  async unmuteScene() {
    if (viewpointsState.get().liveSide !== 'viewpoint') {
      return;
    }
    await viewpointsActions.confirmUnsavedEdits();
    viewpointsActions.unmuteSceneNow();
  },

  /** unmuteScene without the unsaved-edits prompt — remove/replace flows that
   *  already decided the viewpoint (and its edits) are going away. */
  unmuteSceneNow() {
    const s = viewpointsState.get();
    if (s.liveSide !== 'viewpoint') {
      return;
    }
    labelsActions.setAll(clone(s.stash?.labels ?? []));
    setMeasurements(clone(s.stash?.measurements ?? []));
    viewpointsState.set({ liveSide: 'scene', stash: null, editing: false });
  },

  /** Unmute the VIEWPOINT editors again (mutes the scene panels): parks the
   *  scene sets and brings the active viewpoint's back — no camera move. */
  unmuteViewpoint() {
    const s = viewpointsState.get();
    const vp = s.list.find((v) => v.id === s.activeId);
    if (!vp || s.liveSide !== 'scene') {
      return;
    }
    viewpointsState.set({
      stash: { labels: clone(labelsState.get().items), measurements: clone(measurementsState.get().items) },
      liveSide: 'viewpoint',
      editing: false,
    });
    labelsActions.setAll(clone(vp.labels));
    setMeasurements(clone(vp.measurements));
    loadRulesFromViewpoint(vp);
  },

  /** "Copy labels": copy the SCENE (default panel) labels into the viewpoint,
   *  overriding whatever it has. While a viewpoint is live the scene's labels
   *  sit in the stash. */
  copySceneLabels(id = viewpointsState.get().activeId) {
    if (!id) {
      return;
    }
    const s = viewpointsState.get();
    const src = s.liveSide === 'scene' ? labelsState.get().items : (s.stash?.labels ?? []);
    patchViewpoint(id, { labels: clone(src) });
    // the live editors show the active viewpoint's labels — refresh them
    if (s.activeId === id && s.liveSide === 'viewpoint') {
      labelsActions.setAll(clone(src));
    }
    consoleActions.log('info', 'Viewpoints: scene labels copied into the viewpoint');
  },

  /** "Copy measurements": same as copySceneLabels, for measurements. */
  copySceneMeasurements(id = viewpointsState.get().activeId) {
    if (!id) {
      return;
    }
    const s = viewpointsState.get();
    const src = s.liveSide === 'scene' ? measurementsState.get().items : (s.stash?.measurements ?? []);
    patchViewpoint(id, { measurements: clone(src) });
    if (s.activeId === id && s.liveSide === 'viewpoint') {
      setMeasurements(clone(src));
    }
    consoleActions.log('info', 'Viewpoints: scene measurements copied into the viewpoint');
  },

  /** "Copy set colors": copy the GLOBAL Set Color editor's rules into the
   *  viewpoint, overriding its rule set (an untouched default editor copies as
   *  "no rules tied"). */
  copyGlobalRules(id = viewpointsState.get().activeId) {
    if (!id) {
      return;
    }
    const { mode, rules } = multiColorState.get();
    patchViewpoint(id, { colorRules: captureRules(mode, rules) });
    if (viewpointsState.get().activeId === id) {
      const vp = viewpointsState.get().list.find((v) => v.id === id);
      if (vp) {
        loadRulesFromViewpoint(vp);
      }
    }
    consoleActions.log('info', 'Viewpoints: Set Color rules copied into the viewpoint');
  },

  /** One-button re-capture of the camera pose + clipping (box AND shapes). */
  updateCameraClip(id: string) {
    patchViewpoint(id, {
      camera: captureCamera(),
      clipBox: captureClipBox(),
      clipPlanes: clone(ribbonClippingPlaneState.get()),
      clipShapes: clone(clipShapesState.get().shapes),
    });
    consoleActions.log('info', 'Viewpoints: camera & clipping updated');
  },

  setName(id: string, name: string) {
    patchViewpoint(id, { name });
  },

  setDescription(id: string, description: string) {
    patchViewpoint(id, { description });
  },

  /** One fullname per line (blank lines dropped). */
  setFullnames(id: string, text: string) {
    patchViewpoint(id, {
      fullnames: text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    });
  },

  /** Fill the fullname list from the current selection roots. */
  async fullnamesFromSelection(id: string) {
    const pairs = selectionState
      .get()
      .actives.map((k) => k.split(':').map(Number))
      .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([model, entry]) => ({ model, entry }));
    if (pairs.length === 0) {
      dialogs.error('Nothing is selected — select items first, then capture.', 'Viewpoints');
      return;
    }
    const names = await db.entryNames(pairs);
    patchViewpoint(id, { fullnames: names });
    consoleActions.log('info', `Viewpoints: captured ${names.length} fullname(s) from the selection`);
  },

  select(id: string | null) {
    viewpointsState.set({ selectedId: id });
  },

  /** Snapshot a NEW viewpoint (same capture as addViewpoint) inserted
   *  directly BEFORE the given one. */
  addViewpointBefore(id: string) {
    const s = viewpointsState.get();
    const at = s.list.findIndex((v) => v.id === id);
    if (at < 0) {
      return;
    }
    const vp: Viewpoint = {
      id: uid(),
      name: `Viewpoint ${s.list.length + 1}`,
      description: '',
      camera: captureCamera(),
      clipBox: captureClipBox(),
      clipPlanes: clone(ribbonClippingPlaneState.get()),
      clipShapes: clone(clipShapesState.get().shapes),
      labels: [],
      measurements: [],
      colorRules: { mode: 'reset', rules: [] },
      fullnames: [],
    };
    viewpointsState.set({ list: [...s.list.slice(0, at), vp, ...s.list.slice(at)], selectedId: vp.id });
    consoleActions.log('info', `Viewpoints: added "${vp.name}"`);
  },

  /** Move a viewpoint one step up (-1) or down (+1) in the list. */
  move(id: string, dir: -1 | 1) {
    viewpointsState.set((s) => {
      const i = s.list.findIndex((v) => v.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.list.length) {
        return {};
      }
      const list = [...s.list];
      [list[i], list[j]] = [list[j], list[i]];
      return { list };
    });
  },

  remove(id: string) {
    const s = viewpointsState.get();
    if (s.activeId === id && s.liveSide === 'viewpoint') {
      viewpointsActions.unmuteSceneNow();
    }
    viewpointsState.set((p) => ({
      list: p.list.filter((v) => v.id !== id),
      activeId: p.activeId === id ? null : p.activeId,
      selectedId: p.selectedId === id ? null : p.selectedId,
    }));
  },

  /** Save every viewpoint to a JSON file. */
  saveToFile() {
    downloadText('viewpoints.json', JSON.stringify(viewpointsActions.configJson(), null, 2));
  },

  /** The whole viewpoint set as one JSON-safe blob — the SAME shape the Save
   *  button writes to file, and what `loadFromText`/`replaceAll` accept. */
  configJson(): { version: number; viewpoints: Viewpoint[] } {
    return { version: 1, viewpoints: viewpointsState.get().list };
  },

  /** Load viewpoints from a JSON file — REPLACES the current set. */
  loadFromText(text: string) {
    try {
      const n = viewpointsActions.replaceAll(JSON.parse(text));
      consoleActions.log('info', `Viewpoints: loaded ${n} viewpoint(s) from file`);
    } catch (e) {
      dialogs.error(`Could not load the viewpoints file: ${e}`, 'Viewpoints');
    }
  },

  /** Replace the whole viewpoint set from a parsed config blob (a saved file's
   *  contents / `viewpoints.set` payload). Throws on malformed data — callers
   *  surface the error their own way (dialog vs API error). Returns how many
   *  viewpoints were loaded. */
  replaceAll(parsed: unknown): number {
    const data = (parsed ?? {}) as { viewpoints?: Partial<Viewpoint>[] };
    if (!Array.isArray(data.viewpoints)) {
      throw new Error('no viewpoints found in the config');
    }
    const s = viewpointsState.get();
    if (s.liveSide === 'viewpoint') {
      viewpointsActions.unmuteSceneNow();
    }
    const list: Viewpoint[] = data.viewpoints.map((v, i) => ({
      id: uid() + i,
      name: v.name ?? `Viewpoint ${i + 1}`,
      description: v.description ?? '',
      camera: {
        target: v.camera?.target ?? [0, 0, 0],
        azimuth: v.camera?.azimuth ?? 0.6,
        elevation: v.camera?.elevation ?? 0.5,
        orbitDistance: v.camera?.orbitDistance ?? 10,
        orthographic: v.camera?.orthographic ?? false,
        ...(typeof v.camera?.sketch === 'boolean' ? { sketch: v.camera.sketch } : {}),
      },
      clipBox: {
        enabled: v.clipBox?.enabled ?? false,
        boxOn: v.clipBox?.boxOn ?? true,
        center: v.clipBox?.center ?? [0, 0, 0],
        size: v.clipBox?.size ?? [10, 10, 10],
        rotation: v.clipBox?.rotation ?? [0, 0, 0, 1],
        inverted: v.clipBox?.inverted ?? false,
      },
      clipPlanes: v.clipPlanes,
      clipShapes: Array.isArray(v.clipShapes) ? v.clipShapes : [],
      labels: Array.isArray(v.labels) ? v.labels : [],
      measurements: Array.isArray(v.measurements) ? v.measurements : [],
      colorRules: {
        mode: v.colorRules?.mode === 'append' ? 'append' : 'reset',
        // untouched default copies from older files collapse to "no rules"
        rules: (() => {
          const rules = normalizeRules(v.colorRules?.rules);
          return isPristineRuleSet(rules) ? [] : rules;
        })(),
      },
      fullnames: Array.isArray(v.fullnames) ? v.fullnames.filter((n): n is string => typeof n === 'string') : [],
    }));
    viewpointsState.set({ list, activeId: null, selectedId: list[0]?.id ?? null });
    return list.length;
  },

  /** Show/replace or remove (null) the SESSION-ONLY host bookmark button. */
  setBookmarkButton(button: { label: string; tooltip: string } | null) {
    viewpointsState.set({ bookmarkButton: button });
  },

  /** The host bookmark button was clicked: notify the embedding host with the
   *  CURRENT config attached, so it can persist the bookmark without a
   *  follow-up `viewpoints.get` (and without racing later edits). */
  bookmarkClicked() {
    const button = viewpointsState.get().bookmarkButton;
    if (!button) {
      return;
    }
    emitApiEvent('viewpoints.bookmark', { label: button.label, config: viewpointsActions.configJson() });
  },
};
