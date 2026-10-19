// Posing and Key (DESIGN.md › Animation › Authoring), the way Blender keys:
// a gizmo drag only POSES the objects it moves — drawn on top of the
// animation, the gizmo follows — and Key (I) keys the pose at the time
// slider into each object's row. Moving the time slider drops a pose not
// keyed yet (a toast says so). Auto-key keys every drag straight away.
// Key on the camera, section, colour-rules or steps row keys that row.

import { toast } from '@treDeSpaceUI/widgets';
import { ribbonSelectionTransformActions } from '../../components/panels/ribbon-selection-transform/ribbonSelectionTransform.actions';
import {
  decomposeRigid,
  keyIndexAt,
  m4Identity,
  m4InvertRigid,
  m4Multiply,
  poseMatrix,
} from '../../lib/animation/interp';
import { keyHere, keyIndexNear, poseAt } from '../../lib/animation/keyRows';
import { keyPivotPoint, type PivotChoice, pivotSpec } from '../../lib/animation/pivots';
import type { AnimObject, Interp, KeyPivot, ObjectKey, Quat, V3 } from '../../lib/animation/types';
import { db } from '../viewer/db';
import { selectionState } from '../viewer/selection.state';
import { refreshSelection, setGizmoCommitInterceptor } from '../viewer/viewer.actions';
import { animationDocState } from './animationDoc.state';
import { animationUiState } from './animationUi.state';
import { annotationsActions } from './annotations.actions';
import { activeScene } from './docEdit';
import { keysActions } from './keys.actions';
import { objectsActions } from './objects.actions';
import { playerState } from './player.state';
import { objectRow, rowObject } from './rows';
import {
  applyNow,
  clearPending,
  clearPendingPoses,
  evalContext,
  liveTimeNow,
  pendingPose,
  pivotOfObject,
  requestBandSync,
  sessionRestBounds,
  setLiveTime,
  setPendingDroppedHandler,
  setPendingPose,
  syncBandToWorker,
  syncSessionNow,
} from './runtime';
import { stepsActions } from './steps.actions';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** The key Key would write now for an object. */
export interface NextKey {
  object: string;
  time: number;
  move: V3;
  rotate: Quat;
  interp: Interp;
  /** a key already sits at the time slider (Key replaces it) */
  replaces: boolean;
  /** the key's pivot (absent: the object's) */
  pivot?: KeyPivot;
}

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let removeKeyListener: (() => void) | null = null;
let removeSelectionSync: (() => void) | null = null;
let removeChoiceReset: (() => void) | null = null;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function objectOf(id: string): AnimObject | null {
  return activeScene(animationDocState.get().doc)?.objects.find((o) => o.id === id) ?? null;
}

/** A double-precision matrix: authoring math far from the origin stays
 *  exact (a key pressed twice without moving lands on the first). */
function f64(): Float64Array {
  return new Float64Array(16);
}

/** The object's delta at T from its keys. */
function poseMatrixAt(o: AnimObject, T: number): Float64Array {
  const s = poseAt(o, T, pivotOfObject(o.id));
  return poseMatrix(s, s.pivot, f64());
}

/** Is the Key panel's next-key choice (interp, pivot) for this object? It
 *  is made for the current object row only — others keyed with it keep
 *  their own. */
function choiceIsFor(o: AnimObject): boolean {
  return rowObject(animationUiState.get().current) === o.id;
}

/** A pivot spec of object `o` as a point (rest coordinates). */
function pivotPoint(o: AnimObject, spec: KeyPivot | undefined): V3 {
  const ctx = evalContext();
  return keyPivotPoint(spec, ctx.boxes?.get(o.id) ?? null, ctx.pivots.get(o.id) ?? [0, 0, 0]);
}

/** The interpolation a key at T gets: the one chosen for the next key, else
 *  the own key's there, else smooth. */
function nextInterpFor(o: AnimObject, T: number): Interp {
  const chosen = choiceIsFor(o) ? animationUiState.get().nextInterp : null;
  return chosen ?? o.keys[keyIndexNear(o.keys, T)]?.interp ?? 'smooth';
}

/** The pivot the next key at T gets: the Key panel's choice, else the own
 *  key's, else that of the key it continues — the same side and offset, so
 *  the pivot stays on the same spot of the object. */
function nextPivotFor(o: AnimObject, own: ObjectKey | undefined, inherited?: KeyPivot): KeyPivot | undefined {
  const choice = choiceIsFor(o) ? animationUiState.get().nextPivot : null;
  if (choice) {
    return pivotSpec(choice, o.pivot, own?.pivot ?? inherited);
  }
  return own ? own.pivot : inherited;
}

/** The key for object `o` at T with the world-space pose G on top of where
 *  it stands: K = G · D (D = its delta from its own keys), said about the
 *  key's pivot (`nextPivotFor`). A key already at T keeps its spin and
 *  instant values. */
function foldKey(o: AnimObject, T: number, G: ArrayLike<number>): ObjectKey {
  const K = m4Multiply(G, poseMatrixAt(o, T), f64());
  const own = o.keys[keyIndexNear(o.keys, T)];
  const { pivot: inherited, ...base } = own ?? keyHere(o, T, 'smooth', pivotOfObject(o.id));
  const pivot = nextPivotFor(o, own, inherited);
  const k = decomposeRigid(K, pivotPoint(o, pivot));
  return { ...base, t: T, move: k.move, rotate: k.rotate, interp: nextInterpFor(o, T), ...(pivot ? { pivot } : {}) };
}

/** The objects Key acts on: the posed ones, else those the selection names
 *  (a selection that is not an object yet becomes one), else the current
 *  object row. */
async function keyTargets(): Promise<string[]> {
  const posing = animationUiState.get().posing;
  if (posing && posing.objects.length > 0) {
    return posing.objects;
  }
  if (selectionState.get().count > 0) {
    return objectsActions.forSelection();
  }
  const current = rowObject(animationUiState.get().current);
  return current && objectOf(current) ? [current] : [];
}

/** Objects made a moment ago are captured before a pose is folded or
 *  drawn: their rest boxes (side pivots) and band slots must be known. */
async function ensureCaptured(ids: readonly string[]): Promise<void> {
  if (ids.some((id) => !sessionRestBounds(id))) {
    await syncSessionNow();
  }
}

/** The keys Key writes for `ids` at T, each with its pose not keyed yet. */
function keysFor(ids: readonly string[], T: number, extra?: ArrayLike<number>): { id: string; key: ObjectKey }[] {
  return ids.flatMap((id) => {
    const o = objectOf(id);
    if (!o) {
      return [];
    }
    const posed = pendingPose(id) ?? m4Identity(f64());
    return [{ id, key: foldKey(o, T, extra ? m4Multiply(extra, posed, f64()) : posed) }];
  });
}

/** `ids` keyed: their poses are gone, the others stay posed; the current
 *  row stays when it is one of them. */
function afterKeyed(ids: readonly string[]): void {
  clearPendingPoses(ids);
  const left = (animationUiState.get().posing?.objects ?? []).filter((x) => !ids.includes(x));
  animationUiState.set({
    posing: left.length > 0 ? { objects: left, rev: (animationUiState.get().posing?.rev ?? 0) + 1 } : null,
    nextInterp: null,
    nextPivot: null,
  });
  keepCurrentAmong(ids);
}

/** The current row moves to the first of `ids` unless it is one of them. */
function keepCurrentAmong(ids: readonly string[]): void {
  const current = rowObject(animationUiState.get().current);
  const first = ids[0];
  if (first && (!current || !ids.includes(current))) {
    animationUiState.set({ current: objectRow(first) });
  }
}

/** The key the next-key choice is about (the picked key, else the current
 *  row) — when it changes, the choice goes: it never leaks to another
 *  object or key. */
function choiceTarget(): string {
  const ui = animationUiState.get();
  const p = ui.picked;
  return p.kind === 'keys' ? `${p.row}#${p.indices[0] ?? ''}` : `${p.kind}:${ui.current ?? ''}`;
}

function installChoiceReset(): void {
  removeChoiceReset?.();
  let last = choiceTarget();
  removeChoiceReset = animationUiState.subscribe(() => {
    const now = choiceTarget();
    if (now === last) {
      return;
    }
    last = now;
    const ui = animationUiState.get();
    if (ui.nextPivot || ui.nextInterp) {
      animationUiState.set({ nextPivot: null, nextInterp: null });
    }
  });
}

/** A pose drawn or keyed: the worker gets it, so the gizmo sits on the
 *  posed items. */
async function afterPose(): Promise<void> {
  applyNow();
  await syncBandToWorker();
  await refreshSelection();
}

function bumpPosing(objects: string[]): void {
  const prev = animationUiState.get().posing;
  animationUiState.set({ posing: { objects, rev: (prev?.rev ?? 0) + 1 } });
}

function onPendingDropped(): void {
  const ui = animationUiState.get();
  if (ui.posing || ui.previewRules) {
    animationUiState.set({ posing: null, previewRules: false });
    toast.info('The pose was not keyed, so it was dropped — press Key (I) before moving the time slider.');
  }
}

/** The authoring gizmo policy: pose (or auto-key) the objects the
 *  selection names; outside authoring the drag only explains itself. */
async function interceptGizmo(G: Float32Array): Promise<boolean> {
  const mode = animationUiState.get().mode.kind;
  if (playerState.get().status === 'off' || mode === 'off') {
    return false;
  }
  if (mode !== 'author') {
    toast.info('Items do not move while the animation plays — turn on Animate to pose and key them.');
    return true;
  }
  const ids = await objectsActions.forSelection();
  if (ids.length === 0) {
    return true;
  }
  await ensureCaptured(ids);
  if (animationUiState.get().autoKey) {
    keysActions.setObjectKeys(keysFor(ids, liveTimeNow(), G));
    afterKeyed(ids);
    await afterPose();
    return true;
  }
  const posed = animationUiState.get().posing?.objects ?? [];
  for (const id of ids) {
    setPendingPose(id, m4Multiply(G, pendingPose(id) ?? m4Identity(f64()), f64()));
  }
  bumpPosing([...new Set([...posed, ...ids])]);
  keepCurrentAmong(ids);
  await afterPose();
  return true;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target instanceof HTMLElement ? e.target : null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** I keys while authoring (Blender's Insert Keyframe) — the viewer's I
 *  (Invert selection) is off meanwhile by its hotkey context; Esc drops a
 *  pose not keyed yet. */
function installKeyListener(): void {
  removeKeyListener?.();
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) {
      return;
    }
    if (e.key === 'Escape' && animationUiState.get().posing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void posingActions.discardPose();
      return;
    }
    if (e.key !== 'i' && e.key !== 'I') {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    void posingActions.key();
  };
  window.addEventListener('keydown', onKey, true);
  removeKeyListener = () => window.removeEventListener('keydown', onKey, true);
}

/** Items selected in the 3D view make their object the current row (not
 *  while a pose waits for Key — the posed row stays current), and the
 *  objects owning them are the objects selected. */
function installSelectionSync(): void {
  removeSelectionSync?.();
  let sig = '';
  removeSelectionSync = selectionState.subscribe(() => {
    const s = selectionState.get();
    const next = `${s.count}|${s.actives.join(',')}|${s.activeGroup}|${s.activeGroups.join(',')}`;
    if (next === sig) {
      return;
    }
    sig = next;
    if (s.count === 0) {
      if (animationUiState.get().objectSelection.length > 0) {
        animationUiState.set({ objectSelection: [] });
      }
      return;
    }
    void db.animSelectedActors().then((owners) => {
      const scene = activeScene();
      const mine = owners.filter((x) => scene?.objects.some((o) => o.id === x));
      animationUiState.set({ objectSelection: mine });
      if (animationUiState.get().posing) {
        return;
      }
      const id = mine[0];
      const current = animationUiState.get().current;
      if (id && !mine.some((x) => current === objectRow(x))) {
        animationUiState.set({ current: objectRow(id), picked: { kind: 'none' } });
      }
    });
  });
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const posingActions = {
  /** Authoring on / off: the gizmo policy, the I key, the selection sync
   *  and the dropped-pose toast. */
  install(on: boolean): void {
    setGizmoCommitInterceptor(on ? interceptGizmo : null);
    setPendingDroppedHandler(on ? onPendingDropped : null);
    if (on) {
      installKeyListener();
      installSelectionSync();
      installChoiceReset();
      return;
    }
    removeKeyListener?.();
    removeKeyListener = null;
    removeSelectionSync?.();
    removeSelectionSync = null;
    removeChoiceReset?.();
    removeChoiceReset = null;
    clearPending();
    animationUiState.set({ posing: null, previewRules: false, nextPivot: null, nextInterp: null });
  },

  /** The gizmo is not consulted outside authoring, except to explain why
   *  nothing moves while the animation only plays. */
  installPlaybackGizmo(on: boolean): void {
    setGizmoCommitInterceptor(on ? interceptGizmo : null);
  },

  /** Key (I): the current row at the time slider — the posed objects, the
   *  selection's objects (made when new), the camera, the section, the
   *  colour rules or a new step. */
  async key(): Promise<void> {
    const ui = animationUiState.get();
    if (ui.mode.kind !== 'author') {
      return;
    }
    const row = ui.current;
    if (!ui.posing && row === '@camera') {
      keysActions.keyCamera();
      return;
    }
    if (!ui.posing && row === '@section') {
      keysActions.keySection();
      return;
    }
    if (!ui.posing && row === '@rules') {
      keysActions.keyRules();
      return;
    }
    if (!ui.posing && (row === '@labels' || row === '@measurements')) {
      annotationsActions.key(row === '@labels' ? 'labels' : 'measurements');
      return;
    }
    if (!ui.posing && row === '@steps') {
      stepsActions.addAtSlider();
      return;
    }
    const ids = await keyTargets();
    if (ids.length === 0) {
      toast.info('Select the items to key (or pick a row in the Timeline) first.');
      return;
    }
    await ensureCaptured(ids);
    // one undo step for every object keyed
    keysActions.setObjectKeys(keysFor(ids, liveTimeNow()));
    afterKeyed(ids);
    await afterPose();
  },

  /** The key Key would write now for the posed / current object. */
  nextKey(id?: string): NextKey | null {
    const ui = animationUiState.get();
    const object = id ?? ui.posing?.objects[0] ?? rowObject(ui.current);
    const o = object ? objectOf(object) : null;
    if (!o) {
      return null;
    }
    const T = liveTimeNow();
    const k = foldKey(o, T, pendingPose(o.id) ?? m4Identity(f64()));
    return {
      object: o.id,
      time: T,
      move: k.move,
      rotate: k.rotate,
      interp: k.interp,
      replaces: keyIndexNear(o.keys, T) >= 0,
      ...(k.pivot ? { pivot: k.pivot } : {}),
    };
  },

  /** Pose by the values the next key would have (the Key panel's Move /
   *  Rotate): the object goes exactly there (G = K · D⁻¹), and the other
   *  objects selected with it move by the same change — a typed gizmo drag.
   *  Objects posed apart keep their own poses. */
  async setPoseValues(patch: { move?: V3; rotate?: Quat }, id?: string): Promise<void> {
    const now = posingActions.nextKey(id);
    const o = now ? objectOf(now.object) : null;
    if (!now || !o) {
      return;
    }
    const T = liveTimeNow();
    const target = poseMatrix(
      { move: patch.move ?? now.move, rotate: patch.rotate ?? now.rotate },
      pivotPoint(o, now.pivot),
      f64(),
    );
    const G = m4Multiply(target, m4InvertRigid(poseMatrixAt(o, T), f64()), f64());
    const change = m4Multiply(G, m4InvertRigid(pendingPose(o.id) ?? m4Identity(f64()), f64()), f64());
    const selected = animationUiState.get().objectSelection;
    const along = selected.includes(o.id) ? selected.filter((x) => x !== o.id && objectOf(x)) : [];
    for (const x of along) {
      setPendingPose(x, m4Multiply(change, pendingPose(x) ?? m4Identity(f64()), f64()));
    }
    setPendingPose(o.id, G);
    const posed = animationUiState.get().posing?.objects ?? [];
    bumpPosing([...new Set([...posed, o.id, ...along])]);
    await afterPose();
  },

  /** The interpolation the next key gets (until it is keyed). */
  setNextInterp(interp: Interp): void {
    animationUiState.set({ nextInterp: interp });
  },

  /** The pivot the next key gets (until it is keyed): the pose stays, its
   *  Move / Rotate are then about that pivot. */
  setNextPivot(choice: PivotChoice | null): void {
    animationUiState.set({ nextPivot: choice });
  },

  /** Move the time slider and take every pose along — each posed object
   *  stays where it is drawn (its key values stay) — the Key panel's Time
   *  while posing. */
  async movePoseTo(time: number): Promise<void> {
    const posed = animationUiState.get().posing?.objects ?? [];
    if (posed.length === 0) {
      setLiveTime(time);
      requestBandSync();
      return;
    }
    const T0 = liveTimeNow();
    const held = posed.flatMap((x) => {
      const o = objectOf(x);
      return o ? [{ o, K: m4Multiply(pendingPose(x) ?? m4Identity(f64()), poseMatrixAt(o, T0), f64()) }] : [];
    });
    setLiveTime(time, true);
    const T1 = liveTimeNow();
    for (const { o, K } of held) {
      setPendingPose(o.id, m4Multiply(K, m4InvertRigid(poseMatrixAt(o, T1), f64()), f64()));
    }
    bumpPosing(posed);
    await afterPose();
  },

  /** The Timeline's Move / Rotate: the gizmo on the current object (its
   *  items selected when nothing is), pressed again it goes away. */
  async gizmo(mode: 'move' | 'rotate'): Promise<void> {
    const current = rowObject(animationUiState.get().current);
    if (selectionState.get().count === 0 && current) {
      await objectsActions.selectItems(current);
    }
    ribbonSelectionTransformActions.setGizmoMode(mode);
  },

  /** Drop the pose not keyed yet. */
  async discardPose(): Promise<void> {
    if (!animationUiState.get().posing) {
      return;
    }
    clearPendingPoses();
    animationUiState.set({ posing: null });
    await afterPose();
  },

  /** Is a key of this object at the time slider (the gizmo then edits it)? */
  keyAtSlider(id: string): number {
    const o = objectOf(id);
    return o ? keyIndexNear(o.keys, liveTimeNow()) : -1;
  },

  /** The key before the time slider of an object (−1 = none). */
  keyBeforeSlider(id: string): number {
    const o = objectOf(id);
    return o ? keyIndexAt(o.keys, liveTimeNow() - 1e-6) : -1;
  },
};
