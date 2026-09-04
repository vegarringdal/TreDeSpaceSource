// The outlier-resistant "dense" box of a zone's visible items — what every
// residency decision (frustum, clip, coverage priority) is made against
// instead of the union AABB, because one item parked a kilometre away must
// not inflate a zone until it swallows the camera.
//
// Two passes over the item centres: mean ± 2σ, then the same statistics over
// only the items inside that first box. σ itself is not robust — ten items
// in 10 m plus one at 1 km give σ ≈ 300 m — so the first box may still be
// wide; the second pass shrinks it to the cluster once the outlier is out.

const SIGMAS = 2;

/** Accumulates the boxes of a zone's visible items and yields the dense box. */
export class DenseBoxAccumulator {
  private centres: number[] = [];
  private halfSum = 0;
  private n = 0;
  private readonly min = [Infinity, Infinity, Infinity];
  private readonly max = [-Infinity, -Infinity, -Infinity];

  /** Add one item's world AABB `[minx,miny,minz,maxx,maxy,maxz]`. */
  add(wb: ArrayLike<number>): void {
    this.n++;
    for (let k = 0; k < 3; k++) {
      this.min[k] = Math.min(this.min[k], wb[k]);
      this.max[k] = Math.max(this.max[k], wb[k + 3]);
      this.centres.push((wb[k] + wb[k + 3]) / 2);
      this.halfSum += (wb[k + 3] - wb[k]) / 6; // average half-extent per axis
    }
  }

  get count(): number {
    return this.n;
  }

  /** Union of everything added, or null when nothing was. */
  union(): number[] | null {
    return this.n > 0 ? [...this.min, ...this.max] : null;
  }

  /** Sigma-clipped mean ± 2σ box padded by the mean half-extent, clamped to
   * the union; null when nothing was added. */
  dense(): number[] | null {
    if (this.n === 0) {
      return null;
    }
    const pad = this.halfSum / this.n;
    const first = boxOf(this.centres, this.n, null, pad, this.min, this.max);
    return boxOf(this.centres, this.n, first, pad, this.min, this.max);
  }
}

/** Mean ± SIGMAS·σ of the centres (those inside `within`, when given),
 * padded and clamped. Falls back to every centre when the filter keeps too
 * few to be statistically meaningful. */
function boxOf(
  centres: number[],
  n: number,
  within: number[] | null,
  pad: number,
  min: number[],
  max: number[],
): number[] {
  const mean = [0, 0, 0];
  const m2 = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (within && !inside(centres, o, within)) {
      continue;
    }
    count++;
    for (let k = 0; k < 3; k++) {
      const c = centres[o + k];
      const d = c - mean[k];
      mean[k] += d / count;
      m2[k] += d * (c - mean[k]);
    }
  }
  if (within && count < 2) {
    return within; // the clip left nothing to refine — keep the first box
  }
  const out = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const sd = count > 1 ? Math.sqrt(m2[k] / (count - 1)) : 0;
    out[k] = Math.max(min[k], mean[k] - SIGMAS * sd - pad);
    out[k + 3] = Math.min(max[k], mean[k] + SIGMAS * sd + pad);
  }
  return out;
}

function inside(centres: number[], o: number, box: number[]): boolean {
  for (let k = 0; k < 3; k++) {
    const c = centres[o + k];
    if (c < box[k] || c > box[k + 3]) {
      return false;
    }
  }
  return true;
}
