// Clip uniform packing — builds the ClipData UBO (planes + default box as
// shape slot 0 + user shapes in slots 1..7, native clip.rs layout) and the
// helper line list, from the clipping ribbon + clip-shapes stores. Pure data
// assembly; the viewport uploads the result each frame.
import { type Quat, quatAxes } from '../../../lib/math/quat';
import type { Renderer } from '../../../lib/render/renderer';
import { type ClipShape, clipShapesState } from '../../../state/viewer/clipShapes.state';
import { ribbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';
import { ribbonClippingPlaneState } from '../ribbon-clipping-plane/ribbonClippingPlane.state';

type LineFn = (a: number[], b: number[], color: number) => void;

/** The 12 edges of an oriented box — shared by the default-box helper and the
 *  box clip-shape outline. */
function boxEdgeLines(
  center: readonly number[],
  axes: [number[], number[], number[]],
  half: readonly number[],
  line: LineFn,
  color: number,
): void {
  const P = (sx: number, sy: number, sz: number) => [
    center[0] + axes[0][0] * half[0] * sx + axes[1][0] * half[1] * sy + axes[2][0] * half[2] * sz,
    center[1] + axes[0][1] * half[0] * sx + axes[1][1] * half[1] * sy + axes[2][1] * half[2] * sz,
    center[2] + axes[0][2] * half[0] * sx + axes[1][2] * half[1] * sy + axes[2][2] * half[2] * sz,
  ];
  const E: [number[], number[]][] = [
    [P(-1, -1, -1), P(1, -1, -1)],
    [P(-1, 1, -1), P(1, 1, -1)],
    [P(-1, -1, 1), P(1, -1, 1)],
    [P(-1, 1, 1), P(1, 1, 1)],
    [P(-1, -1, -1), P(-1, 1, -1)],
    [P(1, -1, -1), P(1, 1, -1)],
    [P(-1, -1, 1), P(-1, 1, 1)],
    [P(1, -1, 1), P(1, 1, 1)],
    [P(-1, -1, -1), P(-1, -1, 1)],
    [P(1, -1, -1), P(1, -1, 1)],
    [P(-1, 1, -1), P(-1, 1, 1)],
    [P(1, 1, -1), P(1, 1, 1)],
  ];
  for (const [a, b] of E) {
    line(a, b, color);
  }
}

const DEG = Math.PI / 180;

export function sph(elDeg: number, azDeg: number): [number, number, number] {
  const el = elDeg * DEG,
    az = azDeg * DEG;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

/** Outline helper for a sphere/cylinder clip shape, pushed through the GPU line
 *  list (sphere = 3 great circles; cylinder = 2 rim rings + 4 side lines). */
function shapeHelperLines(
  s: ClipShape,
  ax: number[],
  line: (a: number[], b: number[], color: number) => void,
  color: number,
): void {
  const SEG = 40;
  const c = s.center;
  if (s.kind === 'box') {
    // 12 oriented edges from the rotation's local axes
    boxEdgeLines(s.center, quatAxes(s.rotation as Quat), s.halfExtents, line, color);
    return;
  }
  if (s.kind === 'sphere') {
    const ring = (u: number[], v: number[]) => {
      let prev = [c[0] + u[0] * s.radius, c[1] + u[1] * s.radius, c[2] + u[2] * s.radius];
      for (let i = 1; i <= SEG; i++) {
        const t = (i / SEG) * Math.PI * 2;
        const ct = Math.cos(t) * s.radius;
        const st = Math.sin(t) * s.radius;
        const p = [c[0] + u[0] * ct + v[0] * st, c[1] + u[1] * ct + v[1] * st, c[2] + u[2] * ct + v[2] * st];
        line(prev, p, color);
        prev = p;
      }
    };
    ring([1, 0, 0], [0, 1, 0]);
    ring([0, 1, 0], [0, 0, 1]);
    ring([1, 0, 0], [0, 0, 1]);
    return;
  }
  // cylinder: orthonormal basis u,v perpendicular to the axis
  const ref = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = u.map((x) => x / ul);
  const v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const top = [c[0] + ax[0] * s.height, c[1] + ax[1] * s.height, c[2] + ax[2] * s.height];
  const rimPt = (ctr: number[], t: number) => {
    const ct = Math.cos(t) * s.radius;
    const st = Math.sin(t) * s.radius;
    return [ctr[0] + u[0] * ct + v[0] * st, ctr[1] + u[1] * ct + v[1] * st, ctr[2] + u[2] * ct + v[2] * st];
  };
  for (const ctr of [c, top]) {
    let prev = rimPt(ctr, 0);
    for (let i = 1; i <= SEG; i++) {
      const p = rimPt(ctr, (i / SEG) * Math.PI * 2);
      line(prev, p, color);
      prev = p;
    }
  }
  for (let k = 0; k < 4; k++) {
    line(rimPt(c, (k / 4) * Math.PI * 2), rimPt(top, (k / 4) * Math.PI * 2), color);
  }
}

/** Build the ClipData uniform (112 floats) + helper lines from the ribbon stores. */
export function buildClip(renderer: Renderer): { data: Float32Array; lines: Float32Array } {
  const planes = ribbonClippingPlaneState.get();
  const box = ribbonClippingBoxState.get();
  const { min, max } = renderer.sceneBounds;
  const hasScene = Number.isFinite(min[0]);
  const center = hasScene ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0];
  const data = new Float32Array(260); // planes + mask (36) + 8×28 tagged-union shapes
  const du = new Uint32Array(data.buffer);
  const lines: number[] = [];
  const lu = { push: 0 }; // packed colors appended via a scratch view
  const pushVert = (x: number, y: number, z: number, color: number) => {
    lines.push(x, y, z, 0);
    // color goes in as bits; patched after Float32Array conversion
    colorSlots.push({ index: lines.length - 1, color });
    void lu;
  };
  const colorSlots: { index: number; color: number }[] = [];
  const line = (a: number[], b: number[], color: number) => {
    pushVert(a[0], a[1], a[2], color);
    pushVert(b[0], b[1], b[2], color);
  };

  const AXES = ['x', 'y', 'z'] as const;
  const COLORS = [0xff4444ef, 0xff4aa316, 0xfff6823b]; // abgr bits of #ef4444/#16a34a/#3b82f6
  let mask = 0;
  AXES.forEach((axis, i) => {
    const pl = planes[axis];
    const n0 = sph(pl.el, pl.az);
    const base = pl.anchor ?? (center as [number, number, number]);
    const point = [base[0] + n0[0] * pl.position, base[1] + n0[1] * pl.position, base[2] + n0[2] * pl.position];
    const n = pl.flipped ? n0.map((v) => -v) : n0;
    if (pl.enabled) {
      mask |= 1 << i;
      data[i * 4 + 0] = n[0];
      data[i * 4 + 1] = n[1];
      data[i * 4 + 2] = n[2];
      data[i * 4 + 3] = -(n[0] * point[0] + n[1] * point[1] + n[2] * point[2]);
    }
    if (pl.helper && pl.enabled) {
      // small 3x3 m marker rectangle at the plane point (the cut itself is
      // visible on the geometry; the helper just shows the anchor + normal)
      const half = 1.5;
      const ref = Math.abs(n0[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
      let u = [n0[1] * ref[2] - n0[2] * ref[1], n0[2] * ref[0] - n0[0] * ref[2], n0[0] * ref[1] - n0[1] * ref[0]];
      const ul = Math.hypot(u[0], u[1], u[2]) || 1;
      u = u.map((v) => (v / ul) * half);
      const v = [
        (n0[1] * u[2] - n0[2] * u[1]) / half,
        (n0[2] * u[0] - n0[0] * u[2]) / half,
        (n0[0] * u[1] - n0[1] * u[0]) / half,
      ].map((w) => w * half);
      const c = point;
      const corners = [
        [c[0] + u[0] + v[0], c[1] + u[1] + v[1], c[2] + u[2] + v[2]],
        [c[0] - u[0] + v[0], c[1] - u[1] + v[1], c[2] - u[2] + v[2]],
        [c[0] - u[0] - v[0], c[1] - u[1] - v[1], c[2] - u[2] - v[2]],
        [c[0] + u[0] - v[0], c[1] + u[1] - v[1], c[2] + u[2] - v[2]],
      ];
      for (let k = 0; k < 4; k++) {
        line(corners[k], corners[(k + 1) % 4], COLORS[i]);
      }
      line(corners[0], corners[2], COLORS[i]);
      line(corners[1], corners[3], COLORS[i]);
    }
  });
  du[32] = mask;

  // Default clip box → SHAPE SLOT 0 (native clip.rs: box_to_shape) so it
  // combines with the user shapes under the same union-of-keeps semantics.
  // `box.enabled` is the GLOBAL clipping switch (ribbon Enable / Z); `box.boxOn`
  // is the default box itself (the shapes panel's "Hide default").
  const packBoxSlot = (
    base: number,
    c: [number, number, number],
    half: number[],
    rows: [number[], number[], number[]],
    inverted: boolean,
  ) => {
    for (let col = 0; col < 3; col++) {
      data[base + col * 4 + 0] = rows[0][col];
      data[base + col * 4 + 1] = rows[1][col];
      data[base + col * 4 + 2] = rows[2][col];
    }
    for (let r = 0; r < 3; r++) {
      data[base + 12 + r] = -(rows[r][0] * c[0] + rows[r][1] * c[1] + rows[r][2] * c[2]);
    }
    data[base + 15] = 1;
    for (let k = 0; k < 3; k++) {
      data[base + 16 + k] = -half[k];
      data[base + 20 + k] = half[k];
    }
    du[base + 24] = 1; // kind: box
    du[base + 25] = inverted ? 1 : 0;
  };
  const globalOn = box.enabled;
  if (globalOn && box.boxOn) {
    const axes = quatAxes(box.rotation as Quat);
    const half = box.size.map((v) => v / 2);
    packBoxSlot(36, box.center, half, axes, box.inverted);
    if (box.helper) {
      const AMBER = 0xff0b9ef5; // abgr of #f59e0b
      boxEdgeLines(box.center, axes, half, line, AMBER);
    }
  }

  // User clip shapes → slots 1..7 (native clip.rs: build_clip_data), 28 floats
  // each: inv_transform (16, box only) · params0 (4) · params1 (4) · kind_flags
  // (4 u32: kind 0=off/1=box/2=sphere/3=cyl, inverted). A disabled/muted shape
  // (or global clipping off) writes kind 0, matching the native.
  const shp = clipShapesState.get();
  const SHAPE_COL = 0xffb45ea3; // abgr of #a35eb4 (purple)
  let sc = 0;
  for (const s of shp.shapes) {
    if (sc >= 7) {
      break;
    }
    const on = globalOn && s.enabled && !shp.muted;
    const base = 64 + sc * 28;
    sc++;
    const al = Math.hypot(s.axis[0], s.axis[1], s.axis[2]) || 1;
    const ax = [s.axis[0] / al, s.axis[1] / al, s.axis[2] / al];
    if (on) {
      if (s.kind === 'box') {
        // inv_transform = R^T · T(−center): rows are the box's local axes
        const rows = quatAxes(s.rotation as Quat);
        const c = s.center;
        // column-major mat4x4f
        for (let col = 0; col < 3; col++) {
          data[base + col * 4 + 0] = rows[0][col];
          data[base + col * 4 + 1] = rows[1][col];
          data[base + col * 4 + 2] = rows[2][col];
        }
        for (let r = 0; r < 3; r++) {
          data[base + 12 + r] = -(rows[r][0] * c[0] + rows[r][1] * c[1] + rows[r][2] * c[2]);
        }
        data[base + 15] = 1;
        // params0 = local min, params1 = local max
        for (let k = 0; k < 3; k++) {
          data[base + 16 + k] = -s.halfExtents[k];
          data[base + 20 + k] = s.halfExtents[k];
        }
        du[base + 24] = 1; // kind: box
      } else if (s.kind === 'sphere') {
        data[base + 16] = s.center[0];
        data[base + 17] = s.center[1];
        data[base + 18] = s.center[2];
        data[base + 19] = s.radius;
        du[base + 24] = 2; // kind: sphere
      } else {
        data[base + 16] = s.center[0];
        data[base + 17] = s.center[1];
        data[base + 18] = s.center[2];
        data[base + 19] = s.radius;
        data[base + 20] = ax[0];
        data[base + 21] = ax[1];
        data[base + 22] = ax[2];
        data[base + 23] = s.height;
        du[base + 24] = 3; // kind: cylinder
      }
      du[base + 25] = s.inverted ? 1 : 0;
    }
    // Outline helper (drawn through the same GPU line list).
    if (s.showHelper && shp.helpers && on) {
      shapeHelperLines(s, ax, line, SHAPE_COL);
    }
  }

  const larr = new Float32Array(lines);
  const lview = new Uint32Array(larr.buffer);
  for (const cs of colorSlots) {
    lview[cs.index] = cs.color;
  }
  return { data, lines: larr };
}
