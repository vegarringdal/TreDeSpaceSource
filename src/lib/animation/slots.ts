// -----------------------------------------------------------------------------
// animation band writes (DESIGN.md › Animation › Engine) — main thread
// -----------------------------------------------------------------------------
// One mat4 per (actor, base slot) binding. Each frame writes D · base for
// every binding into a contiguous band buffer; the upload is one
// writeBuffer of only the band's used span, and only when something changed.

import { m4Multiply } from './interp';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface SlotBinding {
  actor: string;
  slot: number;
  /** committed matrix the items had at entry (column-major) */
  base: Float32Array;
}

/** The renderer surface the band needs (structural — no import cycle). */
export interface SlotUploader {
  writeTransformSlots(firstSlot: number, data: Float32Array): void;
}

// -----------------------------------------------------------------------------
// slots
// -----------------------------------------------------------------------------

export class AnimationSlots {
  readonly first: number;
  readonly count: number;
  /** the band span, 16 floats per slot (gaps keep identity-free zeros) */
  readonly data: Float32Array;
  private readonly bindings: readonly SlotBinding[];
  private readonly scratch = new Float32Array(16);
  /** each binding's pose last written — evaluate hands back the same object
   *  while an item does not move, so it is skipped */
  private readonly lastPose: (Float32Array | null | undefined)[];
  private changed = true;

  constructor(bindings: readonly SlotBinding[]) {
    this.bindings = bindings;
    const slots = bindings.map((b) => b.slot);
    this.first = slots.length ? Math.min(...slots) : 0;
    this.count = slots.length ? Math.max(...slots) - this.first + 1 : 0;
    this.data = new Float32Array(this.count * 16);
    this.lastPose = bindings.map(() => undefined);
    for (const b of bindings) {
      this.data.set(b.base, (b.slot - this.first) * 16);
    }
  }

  /** Write D·base for every binding (rest = base when an actor has no pose). */
  write(poses: ReadonlyMap<string, Float32Array>): void {
    for (const [i, b] of this.bindings.entries()) {
      const pose = poses.get(b.actor) ?? null;
      if (pose === this.lastPose[i]) {
        continue;
      }
      this.lastPose[i] = pose;
      const out = pose ? m4Multiply(pose, b.base, this.scratch) : b.base;
      const o = (b.slot - this.first) * 16;
      for (let k = 0; k < 16; k++) {
        if (this.data[o + k] !== out[k]) {
          this.data.set(out, o);
          this.changed = true;
          break;
        }
      }
    }
  }

  /** Upload the band if it changed since the last upload (or `force`). */
  upload(renderer: SlotUploader, force = false): boolean {
    if (this.count === 0 || (!this.changed && !force)) {
      return false;
    }
    renderer.writeTransformSlots(this.first, this.data);
    this.changed = false;
    return true;
  }

  /** Current matrix of one actor's first binding (gizmo center, paths). */
  matrixOf(actor: string): Float32Array | null {
    const b = this.bindings.find((x) => x.actor === actor);
    return b ? this.data.subarray((b.slot - this.first) * 16, (b.slot - this.first) * 16 + 16) : null;
  }

  /** Every slot an actor owns (swept bounds go to each of them). */
  slotsOf(actor: string): number[] {
    return this.bindings.filter((b) => b.actor === actor).map((b) => b.slot);
  }

  get size(): number {
    return this.bindings.length;
  }
}
