// CPU tail of the measurement snap — port of the native compute_measure_probe
// classification. The GPU half (measure_snap compute, two-pass atomic arg-min
// over all model triangles) lives in the renderer; this module turns its
// closest-hit triangle + barycentrics into a corner / edge / face probe.

/** Measurement hover result — surface point + a depth-window classification
 *  (face/edge/corner) and a geometric normal, mirroring the native MeasureHit. */
export interface MeasureProbe {
  point: [number, number, number];
  normal: [number, number, number] | null;
  edgeDir: [number, number, number] | null;
  kind: 'face' | 'edge' | 'corner';
}

/** Snap tuning passed to probeMeasureAsync (screen-pixel radii). */
export interface MeasureSnap {
  enabled: boolean;
  corner: boolean;
  edge: boolean;
  /** snap onto the line where two different items intersect (seamProbe) */
  seam: boolean;
  cornerPx: number;
  edgePx: number;
}

type V3 = [number, number, number];

/** One closest-hit result of the snap compute (result words decoded). */
export interface SnapHit {
  /** distance along the sight line */
  t: number;
  u: number;
  v: number;
  A: V3;
  B: V3;
  C: V3;
  /** global item id + 1 (0 = unknown) */
  item: number;
  flags: number;
  color: number;
}

/** The item has an opacity override below 1 — mirrors the shader's
 *  is_transparent (explicit override, or a colour override with alpha). */
export function isTransparentItem(flags: number, color: number): boolean {
  if (flags & 64) {
    return ((flags >>> 25) & 127) < 100;
  }
  if (flags & 16) {
    return ((color >>> 24) & 255) < 255;
  }
  return false;
}

export function hitPoint(h: SnapHit): V3 {
  const wa = 1 - h.u - h.v;
  return [
    wa * h.A[0] + h.u * h.B[0] + h.v * h.C[0],
    wa * h.A[1] + h.u * h.B[1] + h.v * h.C[1],
    wa * h.A[2] + h.u * h.B[2] + h.v * h.C[2],
  ];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

function unitNormal(A: V3, B: V3, C: V3): V3 | null {
  const n = cross(sub(B, A), sub(C, A));
  const l = len(n);
  return l > 1e-12 ? scale(n, 1 / l) : null;
}

/** Distance from `p` to the closest point of triangle ABC (Ericson, Real-Time
 *  Collision Detection 5.1.5). */
export function distanceToTriangle(p: V3, A: V3, B: V3, C: V3): number {
  const ab = sub(B, A);
  const ac = sub(C, A);
  const ap = sub(p, A);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) {
    return len(ap);
  }
  const bp = sub(p, B);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) {
    return len(bp);
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return len(sub(p, add(A, scale(ab, v))));
  }
  const cp = sub(p, C);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) {
    return len(cp);
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return len(sub(p, add(A, scale(ac, w))));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return len(sub(p, add(B, scale(sub(C, B), w))));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return len(sub(p, add(A, add(scale(ab, v), scale(ac, w)))));
}

/** Where segment PQ crosses the plane (n · x = d), or null. */
function edgePlaneCrossing(P: V3, Q: V3, n: V3, d: number): V3 | null {
  const dp = dot(n, P) - d;
  const dq = dot(n, Q) - d;
  if ((dp > 0 && dq > 0) || (dp < 0 && dq < 0) || dp === dq) {
    return null;
  }
  return add(P, scale(sub(Q, P), dp / (dp - dq)));
}

/**
 * Seam snap: `a` is the closest hit under the cursor, `b` the closest hit of a
 * DIFFERENT item along the same sight line (the surface just behind). Their
 * triangle planes intersect in a line; where that line passes within the edge
 * radius of the cursor — and lies on BOTH triangles, so a surface merely
 * hidden behind `a` cannot fake it — the point on the line nearest the sight
 * line is an edge snap, and where the line crosses a triangle edge of either
 * hit within the corner radius, a corner. `footprint(t)` is the world size of
 * one pixel at sight-line distance t (the containment tolerance).
 */
export function seamProbe(
  a: SnapHit,
  b: SnapHit,
  ray: { origin: V3; dir: V3 },
  px: number,
  py: number,
  snap: MeasureSnap,
  worldToPixel: WorldToPixel,
  footprint: (t: number) => number,
): MeasureProbe | null {
  const nA = unitNormal(a.A, a.B, a.C);
  const nB = unitNormal(b.A, b.B, b.C);
  if (!nA || !nB) {
    return null;
  }
  const cosAB = dot(nA, nB);
  const denom = 1 - cosAB * cosAB;
  if (denom < 1e-4) {
    return null; // (near-)parallel surfaces have no usable seam line
  }
  const dA = dot(nA, a.A);
  const dB = dot(nB, b.A);
  // a point on both planes, then the line through it along nA × nB
  const x0 = scale(add(scale(nA, dA - dB * cosAB), scale(nB, dB - dA * cosAB)), 1 / denom);
  const dir = cross(nA, nB);
  const u = scale(dir, 1 / len(dir));
  // closest point of the seam line to the sight line
  const w0 = sub(ray.origin, x0);
  const bu = dot(ray.dir, u);
  const lineDenom = 1 - bu * bu;
  if (lineDenom < 1e-6) {
    return null;
  }
  const s = (dot(u, w0) - bu * dot(ray.dir, w0)) / lineDenom;
  const point = add(x0, scale(u, s));
  const tol = footprint(a.t) * 2;
  if (distanceToTriangle(point, a.A, a.B, a.C) > tol || distanceToTriangle(point, b.A, b.B, b.C) > tol) {
    return null; // the planes meet, the surfaces do not
  }
  const cursor: [number, number] = [px + 0.5, py + 0.5];
  const distPx = (w: V3): number => {
    const sp = worldToPixel(w);
    return sp ? Math.hypot(sp[0] - cursor[0], sp[1] - cursor[1]) : Infinity;
  };
  // the sight line points camera → scene; face the normal toward the camera
  const normal: V3 = dot(nA, ray.dir) > 0 ? scale(nA, -1) : nA;
  if (snap.corner) {
    // where the seam crosses an edge of either triangle: a true corner
    let best: V3 | null = null;
    let bestPx = snap.cornerPx;
    const tris: [V3, V3, V3, V3, number][] = [
      [a.A, a.B, a.C, nB, dB],
      [b.A, b.B, b.C, nA, dA],
    ];
    for (const [P, Q, R, n, d] of tris) {
      for (const [e0, e1] of [
        [P, Q],
        [Q, R],
        [R, P],
      ] as [V3, V3][]) {
        const c = edgePlaneCrossing(e0, e1, n, d);
        if (c) {
          const dPx = distPx(c);
          if (dPx <= bestPx) {
            bestPx = dPx;
            best = c;
          }
        }
      }
    }
    if (best) {
      return { point: best, normal, edgeDir: u, kind: 'corner' };
    }
  }
  if (snap.edge && distPx(point) <= snap.edgePx) {
    return { point, normal, edgeDir: u, kind: 'edge' };
  }
  return null;
}

/** World point → device-pixel coords; null when at/behind the projection plane. */
export type WorldToPixel = (p: [number, number, number]) => [number, number] | null;

// Barycentric + screen-space classification (port of the native
// compute_measure_probe tail): corner wins inside its small pixel radius, then
// edges (cursor→edge-foot distance), else face — so sensitivity is
// triangle-size- and zoom-independent.
export function classifySnap(
  A: [number, number, number],
  B: [number, number, number],
  C: [number, number, number],
  u: number,
  v: number,
  dir: [number, number, number],
  px: number,
  py: number,
  snap: MeasureSnap,
  worldToPixel: WorldToPixel,
): MeasureProbe {
  const wa = 1 - u - v;
  const hit: [number, number, number] = [
    wa * A[0] + u * B[0] + v * C[0],
    wa * A[1] + u * B[1] + v * C[1],
    wa * A[2] + u * B[2] + v * C[2],
  ];
  // geometric normal, oriented toward the camera (dir points camera → scene)
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  let n: [number, number, number] = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const nl = Math.hypot(...n);
  if (nl > 1e-12) {
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0) {
      n = [-n[0], -n[1], -n[2]];
    }
  }
  const cursor: [number, number] = [px + 0.5, py + 0.5];
  const distPx = (w: [number, number, number]): number => {
    const s = worldToPixel(w);
    return s ? Math.hypot(s[0] - cursor[0], s[1] - cursor[1]) : Infinity;
  };
  const face = (): MeasureProbe => ({
    point: hit,
    normal: nl > 1e-12 ? n : null,
    edgeDir: null,
    kind: 'face',
  });
  if (!snap.enabled) {
    return face();
  }

  const verts: [number, number, number][] = [A, B, C];
  if (snap.corner) {
    let best = Infinity;
    let bv: [number, number, number] | null = null;
    for (const w of verts) {
      const d = distPx(w);
      if (d < best) {
        best = d;
        bv = w;
      }
    }
    if (bv && best <= snap.cornerPx) {
      return { point: bv, normal: null, edgeDir: null, kind: 'corner' };
    }
  }
  if (snap.edge) {
    let best = Infinity;
    let bp: [number, number, number] | null = null;
    let bd: [number, number, number] | null = null;
    for (let i = 0; i < 3; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 3];
      // closest point on segment [a,b] to the hit point
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const t =
        len2 > 1e-18
          ? Math.max(
              0,
              Math.min(1, ((hit[0] - a[0]) * ab[0] + (hit[1] - a[1]) * ab[1] + (hit[2] - a[2]) * ab[2]) / len2),
            )
          : 0;
      const foot: [number, number, number] = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
      const d = distPx(foot);
      if (d < best) {
        best = d;
        bp = foot;
        const al = Math.sqrt(len2) || 1;
        bd = [ab[0] / al, ab[1] / al, ab[2] / al];
      }
    }
    if (bp && best <= snap.edgePx) {
      return { point: bp, normal: null, edgeDir: bd, kind: 'edge' };
    }
  }
  return face();
}
