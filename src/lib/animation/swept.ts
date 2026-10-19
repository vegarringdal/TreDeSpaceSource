// -----------------------------------------------------------------------------
// swept bounds (DESIGN.md › Animation › Engine)
// -----------------------------------------------------------------------------
// A conservative world box per object covering every pose it takes in the
// scene, so the VRAM budget never evicts an item that is about to move into
// view. Sampled at its key times plus a fixed rate inside each moving
// segment (between them nothing moves it), and padded.

import { evaluateObject, objectMotionTimes } from './evaluate';
import { m4TransformPoint } from './interp';
import type { Scene, V3 } from './types';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Relative padding on the swept box (absorbs rotation between samples). */
const SWEPT_PAD = 0.02;
/** Upper bound on samples per segment, whatever its length. */
const MAX_SAMPLES_PER_SEGMENT = 400;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function growByBox(out: Float32Array, box: ArrayLike<number>, m: Float32Array | null): void {
  for (let c = 0; c < 8; c++) {
    const p: V3 = [box[c & 1 ? 3 : 0], box[c & 2 ? 4 : 1], box[c & 4 ? 5 : 2]];
    const q = m ? m4TransformPoint(m, p) : p;
    for (let k = 0; k < 3; k++) {
      out[k] = Math.min(out[k], q[k]);
      out[k + 3] = Math.max(out[k + 3], q[k]);
    }
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Swept world box per object (`restBounds`: object → rest world box). */
export function sweptBoundsAll(
  scene: Scene,
  duration: number,
  restBounds: ReadonlyMap<string, ArrayLike<number>>,
  pivots: ReadonlyMap<string, V3>,
  samplesPerSecond = 10,
): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  const rate = Math.max(1, samplesPerSecond);
  for (const o of scene.objects) {
    const box = restBounds.get(o.id);
    if (!box) {
      continue;
    }
    const b = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    growByBox(b, box, null);
    const pivot = pivots.get(o.id) ?? [0, 0, 0];
    for (const T of objectMotionTimes(
      o,
      0,
      Math.max(duration, o.keys[o.keys.length - 1]?.t ?? 0),
      rate,
      MAX_SAMPLES_PER_SEGMENT,
    )) {
      growByBox(b, box, evaluateObject(o, T, pivot, box).pose);
    }
    const pad = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * SWEPT_PAD;
    for (let k = 0; k < 3; k++) {
      b[k] -= pad;
      b[k + 3] += pad;
    }
    out.set(o.id, b);
  }
  return out;
}
