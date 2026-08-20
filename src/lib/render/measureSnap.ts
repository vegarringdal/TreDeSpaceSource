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
  cornerPx: number;
  edgePx: number;
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
