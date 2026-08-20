import type { V3 } from '../../../lib/math/quat';
import { db } from '../../../state/viewer/db';
import { getRenderer } from '../../../state/viewer/viewer.actions';

/** Selection AABB, falling back to the scene bounds (native fit target). */
export async function fitTarget(): Promise<{ mn: V3; mx: V3 } | null> {
  const sel = await db.selectionBounds();
  if (sel) {
    return { mn: sel.min, mx: sel.max };
  }

  const r = getRenderer();
  if (r && Number.isFinite(r.sceneBounds.min[0])) {
    return { mn: r.sceneBounds.min as V3, mx: r.sceneBounds.max as V3 };
  }

  return null;
}

/** Copy `v` with one axis replaced. */
export function setAxis(v: V3, ax: 0 | 1 | 2, x: number): V3 {
  const out: V3 = [...v];
  out[ax] = x;
  return out;
}
