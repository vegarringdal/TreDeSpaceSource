// Keys on every row (DESIGN.md › Animation › Authoring): object keys,
// camera, section and colour-rules keys — set at the time slider, edited,
// retimed, deleted, copied and pasted. Rows stay sorted with one key per
// moment. Every edit goes through commit (undoable).

import { toast } from '@treDeSpaceUI/widgets';
import { openAnimationPanel } from '../../components/panels/animation/animationPanels';
import { viewFromPoints } from '../../lib/animation/cameraEye';
import { keyIndexAt } from '../../lib/animation/interp';
import {
  copyKeys,
  insertObjectKey,
  instantAt,
  keyHere,
  keyIndexNear,
  keyPivotWorld,
  pasteKeys,
  removeKeys,
  rePivot,
  retimeKeys,
  upsertKey,
} from '../../lib/animation/keyRows';
import { type PivotChoice, pivotSpec } from '../../lib/animation/pivots';
import { orbitKeys } from '../../lib/animation/presets';
import type {
  AnimationDoc,
  AnimObject,
  CameraKey,
  Interp,
  KeyPivot,
  ObjectKey,
  RulesKey,
  Scene,
  SectionKey,
  V3,
} from '../../lib/animation/types';
import { viewpointsState } from '../viewer/viewpoints.state';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { animationUiState, type Picked } from './animationUi.state';
import { activeScene, mapActiveScene } from './docEdit';
import { type KeyClip, keyClipboardState } from './keyClipboard.state';
import { playerActions } from './player.actions';
import { isKeyRow, isSetRow, type KeyRow, objectRow, rowObject } from './rows';
import { rulesEditorState } from './rulesEditor.state';
import { clearPendingRules, liveTimeNow, pivotOfObject, runtimeRenderer } from './runtime';
import { captureCameraPose } from './runtimeCamera';
import { captureClipState } from './runtimeClip';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** A row edit that works on any kind of key. */
type RowEdit = <K extends { t: number }>(keys: readonly K[]) => K[];

/** The instant values a "from here" key sets. */
type InstantPatch = Pick<ObjectKey, 'visible' | 'opacity' | 'color'>;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function scene(): Scene | null {
  return activeScene();
}

/** The keys of a row of the active scene ([] when it is gone). */
export function rowKeys(s: Scene | null, row: KeyRow): readonly { t: number }[] {
  if (!s) {
    return [];
  }
  if (row === '@camera') {
    return s.camera;
  }
  if (row === '@section') {
    return s.section;
  }
  if (row === '@rules') {
    return s.colorRules;
  }
  if (row === '@labels') {
    return s.labels;
  }
  if (row === '@measurements') {
    return s.measurements;
  }
  return s.objects.find((o) => o.id === rowObject(row))?.keys ?? [];
}

/** `s` with one row's keys replaced by `fn` of that row's keys in `from`
 *  (the same scene, or how a drag found it). */
function editSceneFrom(s: Scene, from: Scene, row: KeyRow, fn: RowEdit): Scene {
  if (row === '@camera') {
    return { ...s, camera: fn(from.camera) };
  }
  if (row === '@section') {
    return { ...s, section: fn(from.section) };
  }
  if (row === '@rules') {
    return { ...s, colorRules: fn(from.colorRules) };
  }
  if (row === '@labels') {
    return { ...s, labels: fn(from.labels) };
  }
  if (row === '@measurements') {
    return { ...s, measurements: fn(from.measurements) };
  }
  const id = rowObject(row);
  const src = from.objects.find((o) => o.id === id);
  return src ? { ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, keys: fn(src.keys) } : o)) } : s;
}

function editScene(s: Scene, row: KeyRow, fn: RowEdit): Scene {
  return editSceneFrom(s, s, row, fn);
}

/** Commit an edit of one row of the active scene. */
function editRow(row: KeyRow, fn: RowEdit, coalesce?: string): void {
  animationDocActions.commit((d) => mapActiveScene(d, (s) => editScene(s, row, fn)), coalesce);
}

function objectOf(doc: AnimationDoc, id: string): AnimObject | null {
  return activeScene(doc)?.objects.find((o) => o.id === id) ?? null;
}

/** Edit one object's keys. */
function editObjectKeys(id: string, fn: (keys: readonly ObjectKey[], o: AnimObject) => ObjectKey[], coalesce?: string) {
  animationDocActions.commit(
    (d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: s.objects.map((o) => (o.id === id ? { ...o, keys: fn(o.keys, o) } : o)),
      })),
    coalesce,
  );
}

/** The interpolation a new key at T gets: the next key's (a key inserted
 *  into a movement keeps how it arrives), else the chosen one. */
function interpAt(keys: readonly { t: number; interp: Interp }[], T: number): Interp {
  const next = keys[keyIndexAt(keys, T) + 1];
  return next?.interp ?? animationUiState.get().nextInterp ?? 'smooth';
}

function pick(p: Picked): void {
  animationUiState.set({ picked: p });
}

/** Copies of a row's keys at `indices`, as the clipboard holds them. */
function clipOf(s: Scene, row: KeyRow, indices: readonly number[]): KeyClip | null {
  if (row === '@camera') {
    return { kind: row, keys: copyKeys(s.camera, indices) };
  }
  if (row === '@section') {
    return { kind: row, keys: copyKeys(s.section, indices) };
  }
  if (row === '@rules') {
    return { kind: row, keys: copyKeys(s.colorRules, indices) };
  }
  if (row === '@labels') {
    return { kind: row, keys: copyKeys(s.labels, indices) };
  }
  if (row === '@measurements') {
    return { kind: row, keys: copyKeys(s.measurements, indices) };
  }
  const o = s.objects.find((x) => x.id === rowObject(row));
  return o ? { kind: 'object', keys: copyKeys(o.keys, indices) } : null;
}

/** The scene with copied keys pasted at T (object keys into `object`). */
function pasteInto(s: Scene, clip: KeyClip, object: string | null, T: number): Scene {
  switch (clip.kind) {
    case '@camera':
      return { ...s, camera: pasteKeys(s.camera, clip.keys, T) };
    case '@section':
      return { ...s, section: pasteKeys(s.section, clip.keys, T) };
    case '@rules':
      return { ...s, colorRules: pasteKeys(s.colorRules, clip.keys, T) };
    case '@labels':
      return { ...s, labels: pasteKeys(s.labels, clip.keys, T) };
    case '@measurements':
      return { ...s, measurements: pasteKeys(s.measurements, clip.keys, T) };
    case 'object':
      return {
        ...s,
        objects: s.objects.map((o) => (o.id === object ? { ...o, keys: pasteKeys(o.keys, clip.keys, T) } : o)),
      };
  }
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const keysActions = {
  /** Put an object key in its row (a key at the same time is replaced). */
  setObjectKey(id: string, key: ObjectKey, coalesce?: string): void {
    editObjectKeys(id, (keys) => insertObjectKey(keys, key), coalesce);
  },

  /** Keys for several objects in one undo step (Key on several objects). */
  setObjectKeys(entries: readonly { id: string; key: ObjectKey }[]): void {
    if (entries.length === 0) {
      return;
    }
    const byId = new Map(entries.map((e) => [e.id, e.key]));
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: s.objects.map((o) => {
          const k = byId.get(o.id);
          return k ? { ...o, keys: insertObjectKey(o.keys, k) } : o;
        }),
      })),
    );
  },

  /** Patch one object key; `undefined` values remove an optional field. */
  updateObjectKey(id: string, index: number, patch: Partial<ObjectKey>, coalesce?: string): void {
    editObjectKeys(
      id,
      (keys) =>
        keys.map((k, i) => {
          if (i !== index) {
            return k;
          }
          const next: ObjectKey = { ...k, ...patch };
          for (const f of ['spin', 'pivot', 'visible', 'opacity', 'color'] as const) {
            if (f in patch && patch[f] === undefined) {
              delete next[f];
            }
          }
          return next;
        }),
      coalesce,
    );
  },

  /** The interpolation of keys (object, camera or section rows). */
  setInterp(row: KeyRow, indices: readonly number[], interp: Interp): void {
    if (isSetRow(row)) {
      return;
    }
    const set = new Set(indices);
    editRow(row, <K extends { t: number }>(keys: readonly K[]) =>
      keys.map((k, i) => (set.has(i) && 'interp' in k ? { ...k, interp } : k)),
    );
  },

  /** A key at the time slider on an object holding where it stands, plus
   *  instant values ("Hide from here", "Colour from here"). */
  instantFromHere(ids: readonly string[], patch: InstantPatch): void {
    const T = liveTimeNow();
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (!ids.includes(o.id)) {
            return o;
          }
          const at = keyIndexNear(o.keys, T);
          const base = at >= 0 ? o.keys[at] : keyHere(o, T, interpAt(o.keys, T), pivotOfObject(o.id));
          return { ...o, keys: insertObjectKey(o.keys, { ...base, ...patch }) };
        }),
      })),
    );
  },

  /** Delete keys of a row. */
  deleteKeys(row: KeyRow, indices: readonly number[]): void {
    editRow(row, <K extends { t: number }>(keys: readonly K[]) => removeKeys(keys, indices));
    const p = animationUiState.get().picked;
    if (p.kind === 'keys' && p.row === row) {
      pick({ kind: 'none' });
    }
  },

  /** Delete the picked keys (Delete key, the Key panel's Delete). */
  deletePicked(): boolean {
    const p = animationUiState.get().picked;
    if (p.kind !== 'keys' || p.indices.length === 0) {
      return false;
    }
    keysActions.deleteKeys(p.row, p.indices);
    return true;
  },

  /** Move keys of a row by dt (a drag on the Timeline); the pick follows. */
  retime(row: KeyRow, indices: readonly number[], dt: number, coalesce?: string): number[] {
    const keys = rowKeys(scene(), row);
    const moved = retimeKeys(keys, indices, dt);
    editRow(row, <K extends { t: number }>(ks: readonly K[]) => retimeKeys(ks, indices, dt).keys, coalesce);
    const p = animationUiState.get().picked;
    if (p.kind === 'keys' && p.row === row) {
      pick({ kind: 'keys', row, indices: moved.indices });
    }
    return moved.indices;
  },

  /** A drag on the Timeline: keys of a row moved by dt from where the drag
   *  found them (`base`); returns where they are now. */
  retimeFrom(base: Scene, row: KeyRow, indices: readonly number[], dt: number, coalesce: string): number[] {
    const moved = retimeKeys(rowKeys(base, row), indices, dt);
    animationDocActions.commit(
      (d) =>
        mapActiveScene(d, (s) =>
          editSceneFrom(
            s,
            base,
            row,
            <K extends { t: number }>(keys: readonly K[]) => retimeKeys(keys, indices, dt).keys,
          ),
        ),
      coalesce,
    );
    return moved.indices;
  },

  /** One key to time t (the Key panel's Time). */
  setTime(row: KeyRow, index: number, t: number): void {
    const k = rowKeys(scene(), row)[index];
    if (!k) {
      return;
    }
    const [moved] = keysActions.retime(row, [index], t - k.t, `key-time:${row}`);
    // the time slider stays on the key, so Key still re-poses it
    const now = moved === undefined ? undefined : rowKeys(scene(), row)[moved];
    if (now) {
      playerActions.seek(now.t);
    }
  },

  /** Pick keys of a row and put the time slider on the first. */
  pickKeys(row: KeyRow, indices: number[], additive = false): void {
    const p = animationUiState.get().picked;
    const all = additive && p.kind === 'keys' && p.row === row ? [...new Set([...p.indices, ...indices])] : indices;
    animationUiState.set({ picked: { kind: 'keys', row, indices: all.sort((a, b) => a - b) }, current: row });
    const k = rowKeys(scene(), row)[indices[0] ?? -1];
    if (k && !additive) {
      playerActions.seek(k.t);
    }
  },

  /** The time slider to the previous / next key of the current row (all
   *  rows when there is none). */
  stepKey(dir: -1 | 1): void {
    const s = scene();
    const row = animationUiState.get().current;
    const T = liveTimeNow();
    const rows: KeyRow[] =
      row && isKeyRow(row)
        ? [row]
        : [
            '@camera',
            '@section',
            '@rules',
            '@labels',
            '@measurements',
            ...(s?.objects.map((o) => objectRow(o.id)) ?? []),
          ];
    const times = rows.flatMap((r) => rowKeys(s, r).map((k) => k.t)).sort((a, b) => a - b);
    const t = dir > 0 ? times.find((x) => x > T + 1e-6) : [...times].reverse().find((x) => x < T - 1e-6);
    if (t !== undefined) {
      playerActions.seek(t);
    }
  },

  // ---------------------------------------------------------------------------
  // scene rows
  // ---------------------------------------------------------------------------

  /** The view now as a camera key at the time slider; the view follows the
   *  camera row again. */
  keyCamera(interp?: Interp): void {
    const r = runtimeRenderer();
    const s = scene();
    if (!r || !s) {
      return;
    }
    const T = liveTimeNow();
    const own = s.camera[keyIndexNear(s.camera, T)];
    const key: CameraKey = { t: T, view: captureCameraPose(r), interp: interp ?? own?.interp ?? interpAt(s.camera, T) };
    animationDocActions.commit((d) => mapActiveScene(d, (x) => ({ ...x, camera: upsertKey(x.camera, key) })));
    playerActions.followCamera();
  },

  /** A saved viewpoint's camera as a camera key at the time slider; the
   *  view follows the camera row again. */
  keyViewpoint(viewpointId: string): void {
    const vp = viewpointsState.get().list.find((v) => v.id === viewpointId);
    const s = scene();
    if (!vp || !s) {
      return;
    }
    const T = liveTimeNow();
    const own = s.camera[keyIndexNear(s.camera, T)];
    const key: CameraKey = { t: T, view: structuredClone(vp.camera), interp: own?.interp ?? interpAt(s.camera, T) };
    animationDocActions.commit((d) => mapActiveScene(d, (x) => ({ ...x, camera: upsertKey(x.camera, key) })));
    playerActions.followCamera();
  },

  /** Show or hide an object from the time slider on — whichever it is not
   *  at the time slider now. */
  toggleVisibleFromHere(id: string): void {
    const o = objectOf(animationDocState.get().doc, id);
    if (!o) {
      return;
    }
    const shown = instantAt(o, liveTimeNow()).visible ?? true;
    keysActions.instantFromHere([id], { visible: !shown });
  },

  /** A camera key takes the view now (Take this view). */
  setCameraView(index: number): void {
    const r = runtimeRenderer();
    if (!r) {
      return;
    }
    const view = captureCameraPose(r);
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({ ...s, camera: s.camera.map((k, i) => (i === index ? { ...k, view } : k)) })),
    );
    playerActions.followCamera();
  },

  /** Where a key's pivot is at that key (a point in the model). */
  keyPivotAt(id: string, index: number): V3 | null {
    const k = keysActions.object(id)?.keys[index];
    return k ? keyPivotWorld(k, pivotOfObject(id)) : null;
  },

  /** A key's pivot (undefined / null = the object's): the object stays where
   *  the key has it, its Move / Rotate are then about the new pivot. */
  setKeyPivot(id: string, index: number, spec: KeyPivot | null | undefined): void {
    const k = keysActions.object(id)?.keys[index];
    if (!k) {
      return;
    }
    const pivot = spec ?? undefined;
    const pivotOf = pivotOfObject(id);
    const { move, rotate } = rePivot(k, pivotOf(k), pivotOf({ ...k, pivot }));
    keysActions.updateObjectKey(id, index, { pivot, move, rotate }, `key-pivot:${id}:${index}`);
  },

  /** The Key panel's pivot choice for a picked key. */
  setKeyPivotChoice(id: string, index: number, choice: PivotChoice): void {
    const o = keysActions.object(id);
    const k = o?.keys[index];
    if (!o || !k) {
      return;
    }
    keysActions.setKeyPivot(id, index, pivotSpec(choice, o.pivot, k.pivot));
  },

  /** A camera key looks from `eye` at `target` (the Key panel's points). */
  setCameraPoints(index: number, eye: V3, target: V3): void {
    const k = scene()?.camera[index];
    const view = k ? viewFromPoints(k.view, eye, target) : null;
    if (!view) {
      toast.info('The position and the target must be two different points.');
      return;
    }
    animationDocActions.commit(
      (d) => mapActiveScene(d, (s) => ({ ...s, camera: s.camera.map((x, i) => (i === index ? { ...x, view } : x)) })),
      `camera-points:${index}`,
    );
    playerActions.followCamera();
  },

  /** One turn around what the view looks at, from the time slider on. */
  cameraOrbit(): void {
    const r = runtimeRenderer();
    if (!r) {
      return;
    }
    const orbit = orbitKeys(captureCameraPose(r), liveTimeNow());
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({ ...s, camera: orbit.reduce((keys, k) => upsertKey(keys, k), s.camera) })),
    );
    playerActions.followCamera();
  },

  /** The clipping now as a section key at the time slider. */
  keySection(interp?: Interp): void {
    const s = scene();
    if (!s) {
      return;
    }
    const T = liveTimeNow();
    const own = s.section[keyIndexNear(s.section, T)];
    const key: SectionKey = {
      t: T,
      value: captureClipState(),
      interp: interp ?? own?.interp ?? interpAt(s.section, T),
    };
    animationDocActions.commit((d) => mapActiveScene(d, (x) => ({ ...x, section: upsertKey(x.section, key) })));
  },

  /** A section key takes the clipping now (Take this clipping). */
  setSectionValue(index: number): void {
    const value = captureClipState();
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({ ...s, section: s.section.map((k, i) => (i === index ? { ...k, value } : k)) })),
    );
  },

  /** The Key panel's colour rules as a colour-rules key at the time slider. */
  keyRules(): void {
    const { mode, rules } = rulesEditorState.get();
    if (mode === 'append' && !rules.some((r) => r.enabled)) {
      toast.info('Add a rule in the Key panel first (Rules ▾ on the Timeline has quick ones).');
      animationUiState.set({ current: '@rules' });
      openAnimationPanel('animation');
      return;
    }
    const T = liveTimeNow();
    const key: RulesKey = { t: T, mode, rules: structuredClone(rules) };
    animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, colorRules: upsertKey(s.colorRules, key) })));
    // the preview became the key; a pose not keyed yet stays posed
    clearPendingRules();
    animationUiState.set({ previewRules: false });
    const i = keyIndexNear(scene()?.colorRules ?? [], T);
    if (i >= 0) {
      keysActions.pickKeys('@rules', [i]);
    }
  },

  // ---------------------------------------------------------------------------
  // copy / paste
  // ---------------------------------------------------------------------------

  /** Copy the picked keys (Ctrl+C on the Timeline). */
  copyPicked(): boolean {
    const p = animationUiState.get().picked;
    const s = scene();
    if (p.kind !== 'keys' || p.indices.length === 0 || !s) {
      return false;
    }
    const clip = clipOf(s, p.row, p.indices);
    if (!clip) {
      return false;
    }
    keyClipboardState.set({ clip });
    toast.info(`${clip.keys.length} key(s) copied — pick a row and paste at the time slider.`);
    return true;
  },

  /** Paste copied keys at the time slider into the current row (object keys
   *  into any object row, the others into their own row). */
  paste(): boolean {
    const clip = keyClipboardState.get().clip;
    const row = animationUiState.get().current;
    if (!clip || !row) {
      return false;
    }
    const T = liveTimeNow();
    const object = rowObject(row);
    if (clip.kind === 'object' && !object) {
      toast.info('Pick an object row to paste object keys into.');
      return false;
    }
    animationDocActions.commit((d) => mapActiveScene(d, (s) => pasteInto(s, clip, object, T)));
    return true;
  },

  /** Find the doc's object (a key edit's target), for the Key panel. */
  object(id: string): AnimObject | null {
    return objectOf(animationDocState.get().doc, id);
  },
};
