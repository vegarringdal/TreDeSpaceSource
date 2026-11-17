// A transform object's pose in a few words, for the list row's header. Pure.

import { qAngleDeg } from '../animation/interp';
import type { Pose } from './types';

/** Below these a value reads as untouched. */
const MOVED_MIN_M = 5e-4;
const TURNED_MIN_DEG = 0.05;
const SCALED_MIN = 5e-4;

function trim(v: number, decimals: number): string {
  return String(+v.toFixed(decimals));
}

/** "1.25 m · 90° · ×1.5" — the distance moved, the angle turned and the
 *  scale (one factor when it is even), each only when it is not at rest;
 *  "at rest" when nothing is. */
export function poseSummary(pose: Pose): string {
  const parts: string[] = [];
  const moved = Math.hypot(pose.move[0], pose.move[1], pose.move[2]);
  if (moved >= MOVED_MIN_M) {
    parts.push(`${trim(moved, 3)} m`);
  }
  const turned = qAngleDeg(pose.rotate);
  if (turned >= TURNED_MIN_DEG) {
    parts.push(`${trim(turned, 1)}°`);
  }
  const [sx, sy, sz] = pose.scale;
  if (pose.scale.some((s) => Math.abs(s - 1) >= SCALED_MIN)) {
    const even = Math.abs(sx - sy) < SCALED_MIN && Math.abs(sy - sz) < SCALED_MIN;
    parts.push(even ? `×${trim(sx, 3)}` : `×${trim(sx, 3)} / ${trim(sy, 3)} / ${trim(sz, 3)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'at rest';
}
