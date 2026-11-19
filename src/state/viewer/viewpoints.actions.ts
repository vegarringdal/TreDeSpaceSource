// Viewpoints: capture / activate / mute-swap / persistence. See
// viewpoints.state.ts for the data model and the scene↔viewpoint mute design.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { makeMultiColorActions, multiColorActions } from '../../components/panels/multi-color/multiColor.actions';
import {
  type ColorRule,
  isPristineRuleSet,
  multiColorState,
  normalizeRules,
} from '../../components/panels/multi-color/multiColor.state';
import { ribbonClippingBoxState } from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.state';
import { ribbonClippingPlaneState } from '../../components/panels/ribbon-clipping-plane/ribbonClippingPlane.state';
import { openViewpointViewerPanel } from '../../components/panels/viewpoints/viewpointsPanel';
import { downloadText } from '../../lib/download';
import { framingDistanceFromPoint } from '../../lib/math/frameFromPoint';
// transport directly (not the messageApi index) — the index imports the
// handlers, which import this module: going through it would be a cycle
import { emitApiEvent } from '../../lib/messageApi/transport';
import { firstLine } from '../../lib/richText';
import { readLabels, readMeasurements } from './annotationInput';
import { clipShapesActions } from './clipShapes.actions';
import { clipShapesState } from './clipShapes.state';
import { db } from './db';
import { labelsActions } from './labels.actions';
import { labelsState, MAX_LABELS, type SceneLabel } from './labels.state';
import { type Measurement, measurementsState } from './measurements.state';
import { selectionState } from './selection.state';
import { getRenderer, viewerActions } from './viewer.actions';
import { viewerState } from './viewer.state';
import { viewpointStepId } from './viewpointStep';
import {
  type TransferKind,
  type TransferUndo,
  type Viewpoint,
  type ViewpointCamera,
  type ViewpointClipBox,
  type ViewpointsState,
  viewpointRulesState,
  viewpointsState,
} from './viewpoints.state';

const clone = <T>(v: T): T => structuredClone(v);

/** Closest a label-made viewpoint's camera gets to the label (metres). */
const LABEL_VIEWPOINT_MIN_DIST_M = 2;
/** camera.ts default vertical FOV, for the (unreachable in practice) no-renderer case. */
const FALLBACK_FOV_Y = (55 * Math.PI) / 180;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The active viewpoint's Set Color actions (bound to viewpointRulesState).
 *  Edits stay in the editor store until "Save to viewpoint" commits them —
 *  nothing auto-saves into the viewpoint record. */
export const viewpointRulesActions = makeMultiColorActions(viewpointRulesState);

function loadRulesFromViewpoint(vp: Viewpoint) {
  viewpointRulesState.set({
    mode: vp.colorRules.mode,
    rules: clone(vp.colorRules.rules),
    counts: [],
    collapsed: [],
    running: false,
  });
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

/** True when the active viewpoint's editors hold unsaved edits. The rules
 *  editor always belongs to the viewpoint; the label/measurement stores only
 *  do while the viewpoint side is live. */
function activeEditsDirty(vp: Viewpoint, liveSide: ViewpointsState['liveSide']): boolean {
  return viewpointRulesDirty(vp) || (liveSide === 'viewpoint' && viewpointSetsDirty(vp));
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

/** Throw the editors' unsaved edits away: reload them from the saved record.
 *  While the scene side is live the label/measurement stores hold the SCENE's
 *  sets, so only the rules revert. */
function revertLiveToSaved(vp: Viewpoint, liveSide: ViewpointsState['liveSide']) {
  loadRulesFromViewpoint(vp);
  if (liveSide === 'viewpoint') {
    labelsActions.setAll(clone(vp.labels));
    setMeasurements(clone(vp.measurements));
  }
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

// -----------------------------------------------------------------------------
// main panels ↔ viewpoint (Get / Return / Undo)
// -----------------------------------------------------------------------------

/** The main Labels panel's set: live while the scene side is, parked in the
 *  stash while a viewpoint is live. */
function mainLabels(): SceneLabel[] {
  const s = viewpointsState.get();
  return s.liveSide === 'scene' ? labelsState.get().items : (s.stash?.labels ?? []);
}

function setMainLabels(items: SceneLabel[]) {
  const s = viewpointsState.get();
  if (s.liveSide === 'scene') {
    labelsActions.setAll(clone(items));
    return;
  }
  viewpointsState.set({ stash: { labels: clone(items), measurements: s.stash?.measurements ?? [] } });
}

function mainMeasurements(): Measurement[] {
  const s = viewpointsState.get();
  return s.liveSide === 'scene' ? measurementsState.get().items : (s.stash?.measurements ?? []);
}

function setMainMeasurements(items: Measurement[]) {
  const s = viewpointsState.get();
  if (s.liveSide === 'scene') {
    setMeasurements(clone(items));
    return;
  }
  viewpointsState.set({ stash: { labels: s.stash?.labels ?? [], measurements: clone(items) } });
}

/** The main Set Color panel's rules, as a viewpoint stores them (an untouched
 *  default editor reads as no rules). */
function mainRules(): Viewpoint['colorRules'] {
  const { mode, rules } = multiColorState.get();
  return captureRules(mode, rules);
}

function setMainRules(r: Viewpoint['colorRules']) {
  multiColorActions.replaceRules(r.mode, clone(r.rules));
}

/** Store a set in the viewpoint record; the live editors follow when they
 *  show this viewpoint. */
function setViewpointLabels(id: string, items: SceneLabel[]) {
  patchViewpoint(id, { labels: clone(items) });
  const s = viewpointsState.get();
  if (s.activeId === id && s.liveSide === 'viewpoint') {
    labelsActions.setAll(clone(items));
  }
}

function setViewpointMeasurements(id: string, items: Measurement[]) {
  patchViewpoint(id, { measurements: clone(items) });
  const s = viewpointsState.get();
  if (s.activeId === id && s.liveSide === 'viewpoint') {
    setMeasurements(clone(items));
  }
}

function setViewpointRules(id: string, r: Viewpoint['colorRules']) {
  patchViewpoint(id, { colorRules: clone(r) });
  const vp = viewpointsState.get().list.find((v) => v.id === id);
  if (vp && viewpointsState.get().activeId === id) {
    loadRulesFromViewpoint(vp);
  }
}

function findViewpoint(id: string | null): Viewpoint | null {
  return id ? (viewpointsState.get().list.find((v) => v.id === id) ?? null) : null;
}

function rememberTransfer(id: string, entry: TransferUndo) {
  viewpointsState.set((s) => ({
    transferUndo: { ...s.transferUndo, [id]: { ...s.transferUndo[id], [entry.kind]: entry } },
  }));
}

function forgetTransfer(id: string, kind: TransferKind) {
  viewpointsState.set((s) => {
    const { [kind]: _done, ...rest } = s.transferUndo[id] ?? {};
    return { transferUndo: { ...s.transferUndo, [id]: rest } };
  });
}

/** What Return would overwrite in the main panel, for its confirm — null
 *  when the main panel holds nothing worth asking about. */
function mainInUse(kind: TransferKind): string | null {
  if (kind === 'labels') {
    const n = mainLabels().length;
    return n > 0 ? `The Labels panel has ${n} label(s)` : null;
  }
  if (kind === 'measurements') {
    const n = mainMeasurements().length;
    return n > 0 ? `The Measurements panel has ${n} measurement(s)` : null;
  }
  const n = mainRules().rules.length;
  return n > 0 ? `The Set Color panel has ${n} rule(s)` : null;
}

function viewpointCount(vp: Viewpoint, kind: TransferKind): string {
  if (kind === 'labels') {
    return `${vp.labels.length} label(s)`;
  }
  if (kind === 'measurements') {
    return `${vp.measurements.length} measurement(s)`;
  }
  return `${vp.colorRules.rules.length} rule(s)`;
}

/** Undo one Get (the viewpoint's set back) or Return (the main panel's). */
function putBack(id: string, entry: TransferUndo) {
  const toViewpoint = entry.op === 'get';
  if (entry.kind === 'labels') {
    if (toViewpoint) {
      setViewpointLabels(id, entry.before);
    } else {
      setMainLabels(entry.before);
    }
    return;
  }
  if (entry.kind === 'measurements') {
    if (toViewpoint) {
      setViewpointMeasurements(id, entry.before);
    } else {
      setMainMeasurements(entry.before);
    }
    return;
  }
  if (toViewpoint) {
    setViewpointRules(id, entry.before);
  } else {
    setMainRules(entry.before);
  }
}

const TRANSFER_NAME: Record<TransferKind, string> = {
  colors: 'Set Color rules',
  labels: 'labels',
  measurements: 'measurements',
};

/** A new viewpoint from the current camera + clipping, otherwise EMPTY: no
 *  labels, measurements, Set Color rules or fullnames. */
function captureViewpoint(name: string): Viewpoint {
  return {
    id: uid(),
    name,
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
}

export const viewpointsActions = {
  /** Snapshot the camera + clipping into a new viewpoint and ACTIVATE it.
   *  The viewpoint starts EMPTY otherwise: no labels, no measurements, no Set
   *  Color rules — use the "Copy …" buttons to bring content in. Activation
   *  loads the empty sets, so on-screen labels/measurements are removed (the
   *  scene's own sets are stashed and come back on unmute); only Set Color
   *  leaves the current colors alone while the viewpoint has no rules. */
  async addViewpoint() {
    const s = viewpointsState.get();
    const vp = captureViewpoint(`Viewpoint ${s.list.length + 1}`);
    viewpointsState.set({ list: [...s.list, vp], selectedId: vp.id });
    consoleActions.log('info', `Viewpoints: added "${vp.name}"`);
    await viewpointsActions.activate(vp.id);
  },

  /** One viewpoint per SELECTED label with a linked fullname: the label's
   *  (first-line) text as the NAME, description blank, the fullname as the
   *  viewpoint's selection, a copy of the label as the viewpoint's own label,
   *  and the camera pivoted on the label's anchor at the distance that frames
   *  the item's box from there — never closer than 2 m, keeping the current
   *  view direction. A label whose fullname + name a viewpoint already
   *  carries is skipped, so re-running only adds what is new. Nothing is
   *  activated; the Viewpoint Viewer panel is opened to show the result. */
  async addFromSelectedLabels() {
    const selected = labelsState.get().items.filter((l) => l.selected);
    if (!selected.some((l) => l.fullname?.trim())) {
      dialogs.error('No selected label has a linked fullname — select labels with a fullname first.', 'Viewpoints');
      return;
    }
    await viewpointsActions.addFromLabels(selected);
    openViewpointViewerPanel();
  },

  /** The core of "labels → viewpoints" — the panel button above and the
   *  `viewpoints.addFromLabels` API command: one viewpoint per given label
   *  with a linked fullname, built as addFromSelectedLabels describes. Labels
   *  without a fullname are ignored, existing fullname + name pairs skipped;
   *  the counts come back for the caller's report. Nothing is activated. */
  async addFromLabels(labels: SceneLabel[]): Promise<{ added: number; skipped: number; ignored: number }> {
    const picks = labels.flatMap((l) => (l.fullname?.trim() ? [{ label: l, fullname: l.fullname.trim() }] : []));
    const fovY = getRenderer()?.camera.fovY ?? FALLBACK_FOV_Y;
    let added = 0;
    let skipped = 0;
    for (const { label, fullname } of picks) {
      const name = firstLine(label.text) || fullname;
      const exists = viewpointsState.get().list.some((v) => v.name === name && v.fullnames.includes(fullname));
      if (exists) {
        skipped++;
        continue;
      }
      const bounds = await db.boundsForNames([fullname]);
      const base = captureViewpoint(name);
      const vp: Viewpoint = {
        ...base,
        fullnames: [fullname],
        labels: [{ ...clone(label), selected: false }],
        camera: {
          ...base.camera,
          target: [label.anchor[0], label.anchor[1], label.anchor[2]],
          orbitDistance: framingDistanceFromPoint(label.anchor, bounds, fovY, LABEL_VIEWPOINT_MIN_DIST_M),
        },
      };
      viewpointsState.set((s) => ({ list: [...s.list, vp] }));
      added++;
    }
    consoleActions.log(
      'info',
      `Viewpoints: added ${added} from labels${skipped ? `, skipped ${skipped} already present` : ''}`,
    );
    return { added, skipped, ignored: labels.length - picks.length };
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

  /** Prev (`dir` -1) / Next (`dir` 1): activate the neighbour of the active
   *  viewpoint in list order, through the normal activate path (so unsaved
   *  edits are asked about). Stops at the ends; with nothing active Next
   *  starts at the first viewpoint and Prev at the last. */
  async step(dir: -1 | 1) {
    const s = viewpointsState.get();
    const id = viewpointStepId(
      s.list.map((v) => v.id),
      s.activeId,
      dir,
    );
    if (id) {
      await viewpointsActions.activate(id);
    }
  },

  /** The "(viewpoint)" bars' Edit button: enter editing (the bar then shows
   *  Save-to-viewpoint, lit once something differs, and Cancel — either one
   *  leaves editing again). */
  startEditing() {
    if (viewpointsState.get().activeId) {
      viewpointsState.set({ editing: true });
    }
  },

  /** When the active viewpoint has unsaved edits, ask whether to save them
   *  (Discard leaves the record as it was, and puts the rules editor back on
   *  it — the callers only swap the label/measurement stores). Call before
   *  switching away. */
  async confirmUnsavedEdits() {
    const s = viewpointsState.get();
    const prev = s.list.find((v) => v.id === s.activeId);
    if (!prev) {
      return;
    }
    if (!activeEditsDirty(prev, s.liveSide)) {
      return;
    }
    const save = await dialogs.confirm(`"${prev.name}" has unsaved edits. Save them to the viewpoint first?`, {
      title: 'Unsaved viewpoint edits',
      okLabel: 'Save',
      cancelLabel: 'Discard',
    });
    if (save) {
      viewpointsActions.saveLiveToActive();
      return;
    }
    loadRulesFromViewpoint(prev);
  },

  /** The Save-to-viewpoint button: commit the viewpoint editors into the
   *  active viewpoint record and leave editing. Rules always save;
   *  labels/measurements save only while the viewpoint side is live (otherwise
   *  the live stores hold the SCENE's sets). This is the ONLY way edits stick —
   *  nothing auto-saves. */
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
    viewpointsState.set({ editing: false });
  },

  /** The Cancel button: leave editing WITHOUT saving. Unsaved edits are
   *  confirmed first, then the editors go back to the saved record. Colors
   *  already painted by a Run while editing stay until the viewpoint is
   *  activated again — re-running the saved rules here could wipe unrelated
   *  coloring in Reset mode. */
  async cancelEditing() {
    const before = viewpointsState.get();
    const vp = before.list.find((v) => v.id === before.activeId);
    if (!vp) {
      return;
    }
    if (!activeEditsDirty(vp, before.liveSide)) {
      viewpointsState.set({ editing: false });
      return;
    }
    const discard = await dialogs.confirm(`Discard the unsaved edits to "${vp.name}"?`, {
      title: 'Cancel editing',
      okLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (!discard) {
      return;
    }
    // the dialog is async: revert whatever is active NOW, from its current record
    const after = viewpointsState.get();
    const current = after.list.find((v) => v.id === after.activeId);
    if (!current) {
      return;
    }
    revertLiveToSaved(current, after.liveSide);
    viewpointsState.set({ editing: false });
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

  /** "Get labels": copy the MAIN Labels panel's labels into the viewpoint,
   *  overriding whatever it has (its row's Undo puts them back). While a
   *  viewpoint is live the main labels sit in the stash. */
  copySceneLabels(id = viewpointsState.get().activeId) {
    const vp = findViewpoint(id);
    if (!vp) {
      return;
    }
    rememberTransfer(vp.id, { kind: 'labels', op: 'get', before: clone(vp.labels) });
    setViewpointLabels(vp.id, mainLabels());
    consoleActions.log('info', 'Viewpoints: main labels copied into the viewpoint');
  },

  /** "Get measurements": same as copySceneLabels, for measurements. */
  copySceneMeasurements(id = viewpointsState.get().activeId) {
    const vp = findViewpoint(id);
    if (!vp) {
      return;
    }
    rememberTransfer(vp.id, { kind: 'measurements', op: 'get', before: clone(vp.measurements) });
    setViewpointMeasurements(vp.id, mainMeasurements());
    consoleActions.log('info', 'Viewpoints: main measurements copied into the viewpoint');
  },

  /** "Get color set": copy the MAIN Set Color panel's rules into the
   *  viewpoint, overriding its rule set (an untouched default editor copies
   *  as "no rules tied"). */
  copyGlobalRules(id = viewpointsState.get().activeId) {
    const vp = findViewpoint(id);
    if (!vp) {
      return;
    }
    rememberTransfer(vp.id, { kind: 'colors', op: 'get', before: clone(vp.colorRules) });
    setViewpointRules(vp.id, mainRules());
    consoleActions.log('info', 'Viewpoints: main Set Color rules copied into the viewpoint');
  },

  /** "Return": put the viewpoint's SAVED set (not unsaved edits in its
   *  editors) into the main panel — where the host API reads it — after a
   *  confirm when the main panel holds something. Rules are not run. */
  async returnToMain(kind: TransferKind, id = viewpointsState.get().activeId) {
    const vp = findViewpoint(id);
    if (!vp) {
      return;
    }
    const used = mainInUse(kind);
    if (used) {
      const ok = await dialogs.confirm(`${used}. Replace them with this viewpoint's ${viewpointCount(vp, kind)}?`, {
        title: `Return ${TRANSFER_NAME[kind]}`,
        okLabel: 'Replace',
      });
      if (!ok) {
        return;
      }
    }
    // the dialog is async: return what the viewpoint holds NOW
    const now = findViewpoint(vp.id);
    if (!now) {
      return;
    }
    if (kind === 'labels') {
      rememberTransfer(now.id, { kind, op: 'return', before: clone(mainLabels()) });
      setMainLabels(now.labels);
    } else if (kind === 'measurements') {
      rememberTransfer(now.id, { kind, op: 'return', before: clone(mainMeasurements()) });
      setMainMeasurements(now.measurements);
    } else {
      rememberTransfer(now.id, { kind, op: 'return', before: mainRules() });
      setMainRules(now.colorRules);
    }
    consoleActions.log('info', `Viewpoints: the viewpoint's ${TRANSFER_NAME[kind]} returned to the main panel`);
  },

  /** Undo the last Get / Return of set `kind` on viewpoint `id`: a Get puts
   *  the viewpoint's previous set back, a Return the main panel's. */
  undoTransfer(kind: TransferKind, id = viewpointsState.get().activeId) {
    const vp = findViewpoint(id);
    const entry = vp ? viewpointsState.get().transferUndo[vp.id]?.[kind] : undefined;
    if (!vp || !entry) {
      return;
    }
    forgetTransfer(vp.id, kind);
    putBack(vp.id, entry);
    const where = entry.op === 'get' ? 'the viewpoint' : 'the main panel';
    consoleActions.log('info', `Viewpoints: ${TRANSFER_NAME[kind]} in ${where} put back`);
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
    const vp = captureViewpoint(`Viewpoint ${s.list.length + 1}`);
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
    viewpointsState.set((p) => {
      const { [id]: _gone, ...transferUndo } = p.transferUndo;
      return {
        list: p.list.filter((v) => v.id !== id),
        activeId: p.activeId === id ? null : p.activeId,
        selectedId: p.selectedId === id ? null : p.selectedId,
        transferUndo,
      };
    });
  },

  /** Delete every viewpoint after a confirm. A live viewpoint's content is
   *  parked back to the scene first (no save prompt — it is being deleted). */
  async removeAll() {
    const n = viewpointsState.get().list.length;
    if (n === 0) {
      return;
    }
    const ok = await dialogs.confirm(`Delete all ${n} viewpoint(s)?`, { okLabel: 'Delete' });
    if (!ok) {
      return;
    }
    if (viewpointsState.get().liveSide === 'viewpoint') {
      viewpointsActions.unmuteSceneNow();
    }
    viewpointsState.set({ list: [], activeId: null, selectedId: null, transferUndo: {} });
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
    // labels + measurements are untrusted (a shared file, a host's stored
    // bookmark): read field by field, like the Labels/Measurements file loads
    const { bg, textColor } = labelsState.get();
    const list: Viewpoint[] = data.viewpoints.map((v, i) => ({
      id: uid() + i,
      name: typeof v.name === 'string' ? v.name : `Viewpoint ${i + 1}`,
      description: typeof v.description === 'string' ? v.description : '',
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
      labels: readLabels(v.labels, { bg, textColor }).slice(0, MAX_LABELS),
      measurements: readMeasurements(v.measurements),
      colorRules: {
        mode: v.colorRules?.mode === 'append' || v.colorRules?.mode === 'hide' ? v.colorRules.mode : 'reset',
        // untouched default copies from older files collapse to "no rules"
        rules: (() => {
          const rules = normalizeRules(v.colorRules?.rules);
          return isPristineRuleSet(rules) ? [] : rules;
        })(),
      },
      fullnames: Array.isArray(v.fullnames) ? v.fullnames.filter((n): n is string => typeof n === 'string') : [],
    }));
    viewpointsState.set({ list, activeId: null, selectedId: list[0]?.id ?? null, transferUndo: {} });
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
