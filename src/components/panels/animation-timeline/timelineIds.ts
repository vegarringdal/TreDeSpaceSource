// Ids of what the Timeline widget draws for a scene: key diamonds, step and
// callout bars, the bars between moving keys and the hatched hidden spans.
// '|' separates the parts (row ids contain ':').

import { asRowId, isKeyRow, type KeyRow } from '../../../state/animation/rows';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type PointRef =
  | { kind: 'key'; row: KeyRow; index: number }
  | { kind: 'calloutKey'; callout: string; index: number }
  | { kind: 'pause'; step: string };

export type ItemRef =
  /** the Scene row's bar: the scene's settings */
  | { kind: 'scene' }
  | { kind: 'step'; id: string }
  | { kind: 'callout'; id: string }
  /** a bar between moving keys or a hidden span: picks its row */
  | { kind: 'span'; row: KeyRow; index: number };

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Row id prefix of a callout's own lane. */
export const CALLOUT_ROW = 'c|';

// -----------------------------------------------------------------------------
// ids
// -----------------------------------------------------------------------------

export const keyPointId = (row: KeyRow, i: number): string => `k|${row}|${i}`;
export const calloutKeyId = (callout: string, i: number): string => `ck|${callout}|${i}`;
export const pauseId = (step: string): string => `p|${step}`;
export const stepItemId = (id: string): string => `s|${id}`;
/** The Scene row's bar (one per scene shown). */
export const SCENE_ITEM_ID = 'sc|';
export const calloutItemId = (id: string): string => `ci|${id}`;
export const spanItemId = (kind: 'seg' | 'hid', row: KeyRow, i: number): string => `${kind}|${row}|${i}`;
export const calloutRowId = (id: string): string => `${CALLOUT_ROW}${id}`;

/** What a point id names, or null. */
export function parsePoint(id: string): PointRef | null {
  const [kind, a, b] = id.split('|');
  const index = Number(b);
  if (kind === 'k' && a) {
    const row = asRowId(a);
    return row && isKeyRow(row) && Number.isInteger(index) ? { kind: 'key', row, index } : null;
  }
  if (kind === 'ck' && a && Number.isInteger(index)) {
    return { kind: 'calloutKey', callout: a, index };
  }
  if (kind === 'p' && a) {
    return { kind: 'pause', step: a };
  }
  return null;
}

/** What an item id names, or null. */
export function parseItem(id: string): ItemRef | null {
  const [kind, a, b] = id.split('|');
  if (kind === 'sc') {
    return { kind: 'scene' };
  }
  if (kind === 's' && a) {
    return { kind: 'step', id: a };
  }
  if (kind === 'ci' && a) {
    return { kind: 'callout', id: a };
  }
  if ((kind === 'seg' || kind === 'hid') && a) {
    const row = asRowId(a);
    return row && isKeyRow(row) ? { kind: 'span', row, index: Number(b) || 0 } : null;
  }
  return null;
}
