// What the Timeline draws for a scene (DESIGN.md › Animation › Authoring):
// the scene rows (Steps, Camera, Section, Colour rules, Callouts and one lane
// per callout) and one row per object; key diamonds (hollow where the key
// holds), bars between keys that move, hatched spans where an object is
// hidden, step and callout bars. Pure — the panel adds the row labels.

import type { TimelineItem, TimelinePoint } from '@treDeSpaceUI/widgets';
import type { AnimObject, Callout, Interp, Scene } from '../../../lib/animation/types';
import type { Picked } from '../../../state/animation/animationUi.state';
import { type KeyRow, objectRow, type RowId, SCENE_ROWS } from '../../../state/animation/rows';
import {
  calloutItemId,
  calloutKeyId,
  calloutRowId,
  keyPointId,
  pauseId,
  SCENE_ITEM_ID,
  spanItemId,
  stepItemId,
} from './timelineIds';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** A row before its label is drawn. */
export interface ModelRow {
  id: string;
  kind: 'group' | 'lane';
  depth: number;
  name: string;
  /** what picking the row makes current (null = a callout lane) */
  row: RowId | null;
  tint?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  /** dimmed (a muted object) */
  muted?: boolean;
}

export interface TimelineModel {
  rows: ModelRow[];
  items: TimelineItem[];
  points: TimelinePoint[];
  /** times a drag snaps to */
  snapTargets: number[];
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const OBJECT_TINTS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#84cc16'];
const STEP_TINT = '#0ea5e9';
const CALLOUT_TINT = '#64748b';
const HIDDEN_TINT = '#334155';
const SCENE_TINT = '#94a3b8';
/** A step bar is drawn at least this wide so its name stays clickable (px). */
const MIN_BAR_PX = 24;
/** The Scene bar is at least this long (s), so an empty scene still has one. */
const MIN_SCENE_S = 1;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function pointsOf(
  row: KeyRow,
  keys: readonly { t: number; interp?: Interp }[],
  picked: ReadonlySet<number>,
  label: string,
): TimelinePoint[] {
  return keys.map((k, i) => ({
    id: keyPointId(row, i),
    row,
    t: k.t,
    shape: 'diamond',
    selected: picked.has(i),
    hollow: k.interp === 'hold',
    label: k.interp === 'hold' ? `${label} (holds, then jumps here)` : label,
  }));
}

/** Bars between consecutive keys the row glides between. */
function glideBars(
  row: KeyRow,
  keys: readonly { t: number; interp: Interp }[],
  tint: string,
  moves: (i: number) => boolean,
) {
  const out: TimelineItem[] = [];
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].interp !== 'hold' && moves(i)) {
      out.push({
        id: spanItemId('seg', row, i),
        row,
        start: keys[i - 1].t,
        end: keys[i].t,
        label: 'Moves',
        span: true,
        fixed: true,
        tint,
      });
    }
  }
  return out;
}

/** Hatched spans where an object is hidden (a hidden key to the next shown
 *  one, or to `end`). */
function hiddenSpans(o: AnimObject, end: number): TimelineItem[] {
  const row = objectRow(o.id);
  const out: TimelineItem[] = [];
  let from: number | null = null;
  let fromIndex = 0;
  for (const [i, k] of o.keys.entries()) {
    if (k.visible === false && from === null) {
      from = i === 0 ? 0 : k.t;
      fromIndex = i;
    } else if (k.visible === true && from !== null) {
      out.push({
        id: spanItemId('hid', row, fromIndex),
        row,
        start: from,
        end: k.t,
        label: 'Hidden',
        hatched: true,
        fixed: true,
        tint: HIDDEN_TINT,
      });
      from = null;
    }
  }
  if (from !== null) {
    out.push({
      id: spanItemId('hid', row, fromIndex),
      row,
      start: from,
      end: Math.max(end, from),
      label: 'Hidden',
      hatched: true,
      fixed: true,
      tint: HIDDEN_TINT,
    });
  }
  return out;
}

const sameMove = (o: AnimObject, i: number) => {
  const a = o.keys[i - 1];
  const b = o.keys[i];
  return a.move.every((x, k) => x === b.move[k]) && a.rotate.every((x, k) => x === b.rotate[k]) && !b.spin;
};

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The Timeline's rows, bars and diamonds for a scene. */
export function buildTimeline(
  scene: Scene,
  picked: Picked,
  duration: number,
  collapsed: ReadonlySet<string>,
  calloutName: (c: Callout) => string,
): TimelineModel {
  const pickedOf = (row: KeyRow) => new Set(picked.kind === 'keys' && picked.row === row ? picked.indices : []);
  const rows: ModelRow[] = [];
  const items: TimelineItem[] = [];
  const points: TimelinePoint[] = [];
  const snap = new Set<number>();
  for (const { row, label } of SCENE_ROWS) {
    const isCallouts = row === '@callouts';
    const isGroup = isCallouts || row === '@objects';
    const children = isCallouts ? scene.callouts.length : row === '@objects' ? scene.objects.length : 0;
    rows.push({
      id: row,
      kind: isGroup ? 'group' : 'lane',
      depth: 0,
      name: row === '@objects' && children > 0 ? `${label} (${children})` : label,
      row,
      tint: SCENE_TINT,
      collapsible: isGroup && children > 0,
      collapsed: collapsed.has(row),
    });
    if (isCallouts && !collapsed.has(row)) {
      for (const c of scene.callouts) {
        const lane = calloutRowId(c.id);
        const name = calloutName(c);
        rows.push({ id: lane, kind: 'lane', depth: 1, name, row: null, tint: CALLOUT_TINT });
        const sel = picked.kind === 'callout' && picked.id === c.id;
        items.push({
          id: calloutItemId(c.id),
          row: lane,
          start: c.start,
          end: c.end,
          label: name,
          selected: sel,
          tint: CALLOUT_TINT,
          minWidth: MIN_BAR_PX,
        });
        for (const [i, k] of (c.keys ?? []).entries()) {
          points.push({
            id: calloutKeyId(c.id, i),
            row: lane,
            t: c.start + k.t,
            shape: 'diamond',
            selected: sel && picked.keys.includes(i),
            label: 'Place',
          });
        }
        snap.add(c.start).add(c.end);
      }
    }
  }
  items.push({
    id: SCENE_ITEM_ID,
    row: '@scene',
    start: 0,
    end: Math.max(duration, MIN_SCENE_S),
    label: scene.name || 'Scene',
    selected: false,
    tint: SCENE_TINT,
    fixed: true,
  });
  for (const s of scene.steps) {
    items.push({
      id: stepItemId(s.id),
      row: '@steps',
      start: s.start,
      end: s.end,
      label: s.name || 'Step',
      selected: picked.kind === 'step' && picked.id === s.id,
      tint: STEP_TINT,
      minWidth: MIN_BAR_PX,
    });
    if (s.pauseAtEnd) {
      points.push({ id: pauseId(s.id), row: '@steps', t: s.end, shape: 'marker', label: 'Pauses here' });
    }
    snap.add(s.start).add(s.end);
  }
  points.push(...pointsOf('@camera', scene.camera, pickedOf('@camera'), 'Camera key'));
  items.push(...glideBars('@camera', scene.camera, SCENE_TINT, () => true));
  points.push(...pointsOf('@section', scene.section, pickedOf('@section'), 'Clipping key'));
  items.push(...glideBars('@section', scene.section, SCENE_TINT, () => true));
  points.push(...pointsOf('@rules', scene.colorRules, pickedOf('@rules'), 'Colour rules'));
  points.push(...pointsOf('@labels', scene.labels, pickedOf('@labels'), 'Labels key'));
  points.push(...pointsOf('@measurements', scene.measurements, pickedOf('@measurements'), 'Measurements key'));
  for (const list of [scene.camera, scene.section, scene.colorRules, scene.labels, scene.measurements]) {
    for (const k of list) {
      snap.add(k.t);
    }
  }
  for (const [n, o] of scene.objects.entries()) {
    for (const k of o.keys) {
      snap.add(k.t);
    }
    if (collapsed.has('@objects')) {
      continue;
    }
    const row = objectRow(o.id);
    const tint = OBJECT_TINTS[n % OBJECT_TINTS.length];
    rows.push({ id: row, kind: 'lane', depth: 1, name: o.name || 'Object', row, tint, muted: o.muted });
    points.push(...pointsOf(row, o.keys, pickedOf(row), o.name || 'Key'));
    items.push(...hiddenSpans(o, duration));
    items.push(...glideBars(row, o.keys, tint, (i) => !sameMove(o, i)));
  }
  return { rows, items, points, snapTargets: [...snap] };
}
