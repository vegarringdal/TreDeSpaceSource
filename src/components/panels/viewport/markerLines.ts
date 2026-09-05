// 3D marker spheres for labels and measurement points: wireframe great
// circles pushed through the renderer's helper line list together with the
// clip helpers, or — for a `solid` marker — instances of the renderer's
// filled unit sphere; both depth tested against the model, so the point
// reads at its true depth. Pure data assembly, rebuilt only when an input
// changes; unit-tested as is.
import type { V3 } from '../../../lib/math/quat';
import type { SceneLabel } from '../../../state/viewer/labels.state';
import type { Measurement } from '../../../state/viewer/measurements.state';
import { readSphereMarker } from '../../../state/viewer/sphereMarker';

const SEGMENTS = 24;
const EMPTY = new Float32Array(0);

export interface MarkerSphere {
  center: V3;
  radius: number;
  /** abgr bits, as the line shader reads them */
  color: number;
  /** rgb 0..1, as the filled-sphere shader reads them */
  rgb: [number, number, number];
  solid: boolean;
  opacity: number;
}

/** Instance floats per filled sphere: centre xyz, radius, rgba. */
export const INSTANCE_FLOATS = 8;
/** A fill at or above this is drawn opaque (depth-writing) rather than blended. */
const OPAQUE_AT = 0.999;

/** `#rrggbb` → the opaque abgr u32 the line pipeline reads. */
export function hexAbgr(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return 0xffffffff;
  }
  const v = Number.parseInt(m[1], 16);
  return (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
}

/** `#rrggbb` → rgb in 0..1 (white when malformed). */
export function hexRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return [1, 1, 1];
  }
  const v = Number.parseInt(m[1], 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function toSphere(center: V3, m: { size: number; color: string; solid: boolean; opacity: number }): MarkerSphere {
  return {
    center,
    radius: m.size,
    color: hexAbgr(m.color),
    rgb: hexRgb01(m.color),
    solid: m.solid,
    opacity: m.opacity,
  };
}

/** Every sphere the annotations ask for — muted labels, hidden measurements
 *  and a muted set contribute none. */
export function collectSpheres(
  labels: readonly SceneLabel[],
  labelsMuted: boolean,
  measurements: readonly Measurement[],
  measurementsMuted: boolean,
): MarkerSphere[] {
  const out: MarkerSphere[] = [];
  if (!labelsMuted) {
    for (const l of labels) {
      const m = l.muted ? null : readSphereMarker(l.sphere);
      if (m) {
        out.push(toSphere(l.anchor, m));
      }
    }
  }
  if (!measurementsMuted) {
    for (const ms of measurements) {
      const m = ms.visible ? readSphereMarker(ms.sphere) : null;
      if (!m) {
        continue;
      }
      for (const p of ms.points) {
        out.push(toSphere(p.pos, m));
      }
    }
  }
  return out;
}

/** Line-list vertices — [x, y, z, colorBits] per vertex, in pairs — for the
 *  spheres: three great circles (xy, yz, xz) of SEGMENTS chords each. */
export function sphereLineVerts(spheres: readonly MarkerSphere[]): Float32Array {
  const perSphere = 3 * SEGMENTS * 2;
  const out = new Float32Array(spheres.length * perSphere * 4);
  const bits = new Uint32Array(out.buffer);
  let k = 0;
  const put = (x: number, y: number, z: number, color: number) => {
    out[k] = x;
    out[k + 1] = y;
    out[k + 2] = z;
    bits[k + 3] = color;
    k += 4;
  };
  for (const s of spheres) {
    const [cx, cy, cz] = s.center;
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
      const c0 = Math.cos(a0) * s.radius;
      const s0 = Math.sin(a0) * s.radius;
      const c1 = Math.cos(a1) * s.radius;
      const s1 = Math.sin(a1) * s.radius;
      put(cx + c0, cy + s0, cz, s.color);
      put(cx + c1, cy + s1, cz, s.color);
      put(cx, cy + c0, cz + s0, s.color);
      put(cx, cy + c1, cz + s1, s.color);
      put(cx + c0, cy, cz + s0, s.color);
      put(cx + c1, cy, cz + s1, s.color);
    }
  }
  return out;
}

/** Instance data for the FILLED spheres, opaque ones first so the renderer
 *  can draw them depth-writing before the translucent ones blend on top. */
export function sphereInstances(spheres: readonly MarkerSphere[]): { data: Float32Array; opaqueCount: number } {
  const opaque = spheres.filter((s) => s.opacity >= OPAQUE_AT);
  const translucent = spheres.filter((s) => s.opacity < OPAQUE_AT);
  const ordered = [...opaque, ...translucent];
  const data = new Float32Array(ordered.length * INSTANCE_FLOATS);
  ordered.forEach((s, i) => {
    const k = i * INSTANCE_FLOATS;
    data[k] = s.center[0];
    data[k + 1] = s.center[1];
    data[k + 2] = s.center[2];
    data[k + 3] = s.radius;
    data[k + 4] = s.rgb[0];
    data[k + 5] = s.rgb[1];
    data[k + 6] = s.rgb[2];
    data[k + 7] = Math.min(1, s.opacity);
  });
  return { data, opaqueCount: opaque.length };
}

export function concatLines(a: Float32Array, b: Float32Array): Float32Array {
  if (b.length === 0) {
    return a;
  }
  if (a.length === 0) {
    return b;
  }
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function sameLines(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** Memo for the marker geometry (wireframe line verts + filled-sphere
 *  instances): rebuilt when an input reference changes, and `version` bumps
 *  only when the data actually differs — so a label drag that leaves the
 *  spheres alone re-uploads nothing and resets no AA. */
export class MarkerCache {
  version = 0;
  lines: Float32Array = EMPTY;
  instances: Float32Array = EMPTY;
  opaqueCount = 0;
  private last: readonly [unknown, boolean, unknown, boolean] | null = null;

  update(
    labels: readonly SceneLabel[],
    labelsMuted: boolean,
    measurements: readonly Measurement[],
    measurementsMuted: boolean,
  ): Float32Array {
    const l = this.last;
    if (l && l[0] === labels && l[1] === labelsMuted && l[2] === measurements && l[3] === measurementsMuted) {
      return this.lines;
    }
    this.last = [labels, labelsMuted, measurements, measurementsMuted];
    const spheres = collectSpheres(labels, labelsMuted, measurements, measurementsMuted);
    const wire = spheres.filter((s) => !s.solid);
    const filled = sphereInstances(spheres.filter((s) => s.solid));
    const nextLines = wire.length ? sphereLineVerts(wire) : EMPTY;
    if (!sameLines(nextLines, this.lines) || !sameLines(filled.data, this.instances)) {
      this.lines = nextLines;
      this.instances = filled.data;
      this.opaqueCount = filled.opaqueCount;
      this.version++;
    }
    return this.lines;
  }
}
