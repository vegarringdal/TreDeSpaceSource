// Clip gizmo overlay: screen-space handles + 2D hit testing + ray math, the
// same interaction model as the vendored transform-gizmo in the native
// project (rendered as SVG on top of the viewport, like the view cube).
//
// Tools:
//   box "move"   — 3 axis arrows (box-LOCAL axes); drag translates.
//   box "scale"  — 3 square handles (local axes); drag scales symmetrically.
//   box "rotate" — 3 rings (local axes); drag sweeps an angle in the ring
//                  plane and composes onto the box quaternion. Shift = 15°.
//   plane "move"   — world-axis arrows translating the plane point.
//   plane "rotate" — 3 world-axis rings reorienting the plane normal.

import { m4AboutPoint, m4AxisRotate, m4AxisScale, m4Translate } from '../math/m4';
import { projectToScreen } from '../math/project';
import { type Quat, quatFromAxisAngle, quatMul, quatNormalize, quatRotate, type V3 } from '../math/quat';
import type { Renderer } from '../render/renderer';

const WORLD_AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const AXIS_COLORS = ['#ef4444', '#22c55e', '#3b82f6'];
const RING_SEGS = 48;
const SNAP = (15 * Math.PI) / 180;

export interface GizmoTargets {
  box: {
    mode: 'move' | 'scale' | 'rotate' | 'faces';
    center: V3;
    size: V3;
    rotation: Quat;
    onChange(center: V3, size: V3): void;
    onRotate(rotation: Quat): void;
  } | null;
  plane: {
    mode: 'move' | 'rotate';
    anchor: V3;
    normal: V3;
    color: string;
    onRotate(elDeg: number, azDeg: number): void;
    onMove(newPoint: V3): void;
  } | null;
  /** Selection transform gizmo (world axes at the selection center). Drags
   * produce a GROUP matrix: onDrag previews it live (model_global), onCommit
   * bakes it into the items' committed transforms on release. 'pivot' mode
   * shows placement arrows instead — the matrix is a pure translation the
   * caller applies to the pivot point, nothing moves geometry. */
  sel: {
    mode: 'move' | 'rotate' | 'scale' | 'pivot';
    center: V3;
    onDrag(group: Float32Array): void;
    onCommit(group: Float32Array): void;
  } | null;
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: V3, b: V3, s = 1): V3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Param of the closest point on line (o, d) to a ray (ro, rd). */
function closestAxisParam(o: V3, d: V3, ro: V3, rd: V3): number {
  const w0 = sub(o, ro);
  const a = dot(d, d);
  const b = dot(d, rd);
  const c = dot(rd, rd);
  const e = dot(rd, w0);
  const f = dot(d, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9) {
    return 0;
  }
  return (b * e - c * f) / denom;
}

/** Plane-local frame: [normal, in-plane u, in-plane v] (stable basis). */
function planeAxes(n: V3): [V3, V3, V3] {
  const ref: V3 = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = cross(n, ref);
  const ul = Math.hypot(...u) || 1;
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  return [n, u, cross(n, u)];
}

/** Ray/plane intersection point (plane through `o` with normal `n`). */
function rayPlane(ro: V3, rd: V3, o: V3, n: V3): V3 | null {
  const denom = dot(rd, n);
  if (Math.abs(denom) < 1e-6) {
    return null;
  }
  const t = dot(sub(o, ro), n) / denom;
  if (t < 0) {
    return null;
  }
  return add(ro, rd, t);
}

type Drag =
  | { kind: 'move' | 'scale' | 'pmove'; axis: number; startParam: number; startCenter: V3; startSize: V3; axisDir: V3 }
  | { kind: 'face'; axis: number; dir: 1 | -1; startParam: number; startCenter: V3; startSize: V3; axisDir: V3 }
  | {
      kind: 'rotate' | 'protate';
      axis: number;
      ringCenter: V3;
      ringNormal: V3;
      startVec: V3;
      startRotation: Quat;
      startNormal: V3;
    }
  | {
      kind: 'smove' | 'sscale';
      axis: number;
      startParam: number;
      startCenter: V3;
      axisDir: V3;
      radius: number;
      last: Float32Array | null;
    }
  | { kind: 'srotate'; axis: number; ringCenter: V3; ringNormal: V3; startVec: V3; last: Float32Array | null };

export class ClipGizmo {
  private svg: SVGSVGElement;
  private drag: Drag | null = null;
  private host: HTMLElement;
  private renderer: Renderer;
  private targets: () => GizmoTargets;

  constructor(host: HTMLElement, renderer: Renderer, targets: () => GizmoTargets) {
    this.host = host;
    this.renderer = renderer;
    this.targets = targets;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;';
    host.appendChild(this.svg);

    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  /** True while a handle drag is in progress (any target). */
  get dragging(): boolean {
    return this.drag !== null;
  }

  dispose() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.svg.remove();
  }

  private toScreen(p: V3): [number, number] | null {
    const r = this.host.getBoundingClientRect();
    return projectToScreen(this.renderer.viewProjMatrix, r.width, r.height, p);
  }

  private localXY(e: PointerEvent): [number, number] {
    const r = this.host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Signed angle swept from the drag-start vector in the ring plane. */
  private ringAngle(d: { ringCenter: V3; ringNormal: V3; startVec: V3 }, e: PointerEvent): number | null {
    const [mx, my] = this.localXY(e);
    const ray = this.renderer.screenRay(mx, my);
    if (!ray) {
      return null;
    }
    const p = rayPlane(ray.origin, ray.dir, d.ringCenter, d.ringNormal);
    if (!p) {
      return null;
    }
    const v = sub(p, d.ringCenter);
    let angle = Math.atan2(dot(cross(d.startVec, v), d.ringNormal), dot(d.startVec, v));
    if (e.shiftKey) {
      angle = Math.round(angle / SNAP) * SNAP;
    }
    return angle;
  }

  private onMove = (e: PointerEvent) => {
    if (!this.drag) {
      return;
    }
    const t = this.targets();
    const d = this.drag;

    if (d.kind === 'rotate' && t.box) {
      const angle = this.ringAngle(d, e);
      if (angle === null) {
        return;
      }
      t.box.onRotate(quatNormalize(quatMul(quatFromAxisAngle(d.ringNormal, angle), d.startRotation)));
      return;
    }
    if (d.kind === 'protate' && t.plane) {
      const angle = this.ringAngle(d, e);
      if (angle === null) {
        return;
      }
      const n = quatRotate(quatFromAxisAngle(d.ringNormal, angle), d.startNormal);
      const el = (Math.asin(Math.max(-1, Math.min(1, n[2]))) * 180) / Math.PI;
      const az = (Math.atan2(n[1], n[0]) * 180) / Math.PI;
      t.plane.onRotate(Math.round(el * 10) / 10, Math.round(az * 10) / 10);
      return;
    }
    if (d.kind === 'srotate' && t.sel) {
      const angle = this.ringAngle(d, e);
      if (angle === null) {
        return;
      }
      const g = m4AboutPoint(
        m4AxisRotate(d.ringNormal as [number, number, number], angle),
        d.ringCenter as [number, number, number],
      );
      d.last = g;
      t.sel.onDrag(g);
      return;
    }
    if ((d.kind === 'smove' || d.kind === 'sscale') && t.sel) {
      const [mx2, my2] = this.localXY(e);
      const ray2 = this.renderer.screenRay(mx2, my2);
      if (!ray2) {
        return;
      }
      const delta = closestAxisParam(d.startCenter, d.axisDir, ray2.origin, ray2.dir) - d.startParam;
      let g: Float32Array;
      if (d.kind === 'smove') {
        g = m4Translate(d.axisDir[0] * delta, d.axisDir[1] * delta, d.axisDir[2] * delta);
      } else {
        // dragging outward by the handle length doubles the size
        const f = Math.max(0.05, 1 + delta / Math.max(d.radius, 1e-3));
        g = m4AboutPoint(
          m4AxisScale(d.axisDir as [number, number, number], f),
          d.startCenter as [number, number, number],
        );
      }
      d.last = g;
      t.sel.onDrag(g);
      return;
    }
    if (d.kind === 'face' && t.box) {
      const [mx2, my2] = this.localXY(e);
      const ray2 = this.renderer.screenRay(mx2, my2);
      if (!ray2) {
        return;
      }
      const param = closestAxisParam(d.startCenter, d.axisDir, ray2.origin, ray2.dir);
      // outward drag along the face direction grows only that side
      const delta = (param - d.startParam) * d.dir;
      const size: V3 = [...d.startSize];
      size[d.axis] = Math.max(0.1, d.startSize[d.axis] + delta);
      const shift = ((size[d.axis] - d.startSize[d.axis]) / 2) * d.dir;
      t.box.onChange(add(d.startCenter, d.axisDir, shift), size);
      return;
    }
    if (d.kind !== 'move' && d.kind !== 'scale' && d.kind !== 'pmove') {
      return;
    }

    const [mx, my] = this.localXY(e);
    const ray = this.renderer.screenRay(mx, my);
    if (!ray) {
      return;
    }
    const param = closestAxisParam(d.startCenter, d.axisDir, ray.origin, ray.dir);
    const delta = param - d.startParam;
    if (d.kind === 'pmove') {
      t.plane?.onMove(add(d.startCenter, d.axisDir, delta));
      return;
    }
    if (!t.box) {
      return;
    }
    if (d.kind === 'move') {
      t.box.onChange(add(d.startCenter, d.axisDir, delta), d.startSize);
    } else {
      const size: V3 = [...d.startSize];
      size[d.axis] = Math.max(0.1, d.startSize[d.axis] + delta * 2);
      t.box.onChange(d.startCenter, size);
    }
  };

  private onUp = () => {
    const d = this.drag;
    if (d && (d.kind === 'smove' || d.kind === 'sscale' || d.kind === 'srotate') && d.last) {
      this.targets().sel?.onCommit(d.last);
    }
    this.drag = null;
  };

  private ringPath(center: V3, normal: V3, radius: number): string | null {
    // basis in the ring plane
    const ref: V3 = Math.abs(normal[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    let u = cross(normal, ref);
    const ul = Math.hypot(...u) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = cross(normal, u);
    const pts: string[] = [];
    for (let i = 0; i <= RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      const p = add(add(center, u, Math.cos(a) * radius), v, Math.sin(a) * radius);
      const sp = this.toScreen(p);
      if (!sp) {
        return null;
      }
      pts.push(`${i === 0 ? 'M' : 'L'}${sp[0].toFixed(1)},${sp[1].toFixed(1)}`);
    }
    return pts.join('');
  }

  /** Handle length for the selection gizmo, in WORLD units: roughly constant
   * on screen (~80 px) with a mild distance factor so far views read a touch
   * bigger and close-ups a touch smaller — independent of selection size. */
  private selRadius(center: V3): number {
    const s0 = this.toScreen(center);
    const f = this.renderer.camera.forward();
    const ref: V3 = Math.abs(f[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    let u = cross(f as V3, ref);
    const ul = Math.hypot(...u) || 1;
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const s1 = this.toScreen(add(center, u, 1));
    if (!s0 || !s1) {
      return 2;
    }
    const ppw = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]); // pixels per world unit
    if (ppw < 1e-4) {
      return 2;
    }
    const eye = this.renderer.camera.eye();
    const dist = Math.hypot(center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]);
    const px = 80 * Math.min(1.5, Math.max(0.7, (dist / 25) ** 0.25));
    return px / ppw;
  }

  /** Re-render the overlay (called once per frame from the viewport tick). */
  update() {
    const t = this.targets();
    const parts: string[] = [];

    // gray guide line along the active drag axis (native-style). Built from
    // samples so the segment behind the camera just drops out instead of
    // killing the whole line.
    const d = this.drag;
    if (
      d &&
      (d.kind === 'move' ||
        d.kind === 'scale' ||
        d.kind === 'pmove' ||
        d.kind === 'face' ||
        d.kind === 'smove' ||
        d.kind === 'sscale')
    ) {
      const pts: string[] = [];
      let started = false;
      for (let i = -32; i <= 32; i++) {
        const sp = this.toScreen(add(d.startCenter, d.axisDir, i * 12));
        if (!sp) {
          started = false;
          continue;
        }
        pts.push(`${started ? 'L' : 'M'}${sp[0].toFixed(1)},${sp[1].toFixed(1)}`);
        started = true;
      }
      if (pts.length > 1) {
        parts.push(
          `<path d="${pts.join('')}" fill="none" stroke="#9ca3af" stroke-width="1.2" stroke-dasharray="6 4" opacity="0.8" />`,
        );
      }
    }

    if (t.box) {
      const c = t.box.center;
      const cs = this.toScreen(c);
      const axes: V3[] = [
        quatRotate(t.box.rotation, [1, 0, 0]),
        quatRotate(t.box.rotation, [0, 1, 0]),
        quatRotate(t.box.rotation, [0, 0, 1]),
      ];
      if (t.box.mode === 'faces') {
        for (let a = 0; a < 3; a++) {
          for (const dir of [1, -1] as const) {
            const ts = this.toScreen(add(c, axes[a], (t.box.size[a] / 2) * dir));
            if (!ts) {
              continue;
            }
            parts.push(
              `<rect data-h="face:${a}:${dir}" x="${ts[0] - 6}" y="${ts[1] - 6}" width="12" height="12" fill="${AXIS_COLORS[a]}" stroke="#0008" style="pointer-events:auto;cursor:grab" />`,
            );
          }
        }
      } else if (t.box.mode === 'rotate') {
        const radius = Math.max(...t.box.size) / 2 + 1;
        for (let a = 0; a < 3; a++) {
          const path = this.ringPath(c, axes[a], radius);
          if (!path) {
            continue;
          }
          parts.push(
            `<path d="${path}" fill="none" stroke="${AXIS_COLORS[a]}" stroke-width="2.5" />`,
            `<path data-h="rotate:${a}" d="${path}" fill="none" stroke="transparent" stroke-width="14" style="pointer-events:stroke;cursor:grab" />`,
          );
        }
      } else if (cs) {
        for (let a = 0; a < 3; a++) {
          const len = Math.max(t.box.size[a] / 2 + 1, 2);
          const ts = this.toScreen(add(c, axes[a], len));
          if (!ts) {
            continue;
          }
          const col = AXIS_COLORS[a];
          parts.push(
            `<line x1="${cs[0]}" y1="${cs[1]}" x2="${ts[0]}" y2="${ts[1]}" stroke="${col}" stroke-width="2.5" />`,
            t.box.mode === 'move'
              ? `<circle data-h="move:${a}" cx="${ts[0]}" cy="${ts[1]}" r="7" fill="${col}" style="pointer-events:auto;cursor:grab" />`
              : `<rect data-h="scale:${a}" x="${ts[0] - 6}" y="${ts[1] - 6}" width="12" height="12" fill="${col}" style="pointer-events:auto;cursor:grab" />`,
          );
        }
      }
    }

    if (t.sel) {
      const c = t.sel.center;
      const cs = this.toScreen(c);
      const radius = this.selRadius(c);
      if (t.sel.mode === 'rotate') {
        for (let a = 0; a < 3; a++) {
          const path = this.ringPath(c, WORLD_AXES[a], radius);
          if (!path) {
            continue;
          }
          parts.push(
            `<path d="${path}" fill="none" stroke="${AXIS_COLORS[a]}" stroke-width="2.5" />`,
            `<path data-h="srotate:${a}" d="${path}" fill="none" stroke="transparent" stroke-width="14" style="pointer-events:stroke;cursor:grab" />`,
          );
        }
      } else if (cs) {
        for (let a = 0; a < 3; a++) {
          const ts = this.toScreen(add(c, WORLD_AXES[a], radius));
          if (!ts) {
            continue;
          }
          const col = AXIS_COLORS[a];
          parts.push(
            `<line x1="${cs[0]}" y1="${cs[1]}" x2="${ts[0]}" y2="${ts[1]}" stroke="${col}" stroke-width="2.5" ${t.sel.mode === 'pivot' ? 'stroke-dasharray="5 3"' : ''} />`,
            t.sel.mode === 'scale'
              ? `<rect data-h="sscale:${a}" x="${ts[0] - 6}" y="${ts[1] - 6}" width="12" height="12" fill="${col}" style="pointer-events:auto;cursor:grab" />`
              : `<circle data-h="smove:${a}" cx="${ts[0]}" cy="${ts[1]}" r="7" fill="${col}" style="pointer-events:auto;cursor:grab" />`,
          );
        }
      }
      if (cs) {
        // pivot placement gets a distinct orange crosshair marker
        parts.push(
          t.sel.mode === 'pivot'
            ? `<circle cx="${cs[0]}" cy="${cs[1]}" r="6" fill="none" stroke="#f97316" stroke-width="2" /><circle cx="${cs[0]}" cy="${cs[1]}" r="2" fill="#f97316" />`
            : `<circle cx="${cs[0]}" cy="${cs[1]}" r="3" fill="#e2e8f0" stroke="#0008" />`,
        );
      }
    }

    if (t.plane) {
      const a = t.plane.anchor;
      const as = this.toScreen(a);
      if (as) {
        if (t.plane.mode === 'rotate') {
          // world-axis rings reorienting the normal, plus the normal itself
          for (let ax = 0; ax < 3; ax++) {
            const path = this.ringPath(a, WORLD_AXES[ax], 2);
            if (!path) {
              continue;
            }
            parts.push(
              `<path d="${path}" fill="none" stroke="${AXIS_COLORS[ax]}" stroke-width="2" />`,
              `<path data-h="protate:${ax}" d="${path}" fill="none" stroke="transparent" stroke-width="14" style="pointer-events:stroke;cursor:grab" />`,
            );
          }
          const ts = this.toScreen(add(a, t.plane.normal, 2.5));
          if (ts) {
            parts.push(
              `<line x1="${as[0]}" y1="${as[1]}" x2="${ts[0]}" y2="${ts[1]}" stroke="${t.plane.color}" stroke-width="2.5" stroke-dasharray="4 3" />`,
            );
          }
        } else {
          // arrows follow the PLANE's orientation: normal + two in-plane axes
          const paxes = planeAxes(t.plane.normal);
          for (let ax = 0; ax < 3; ax++) {
            const ts = this.toScreen(add(a, paxes[ax], 2));
            if (!ts) {
              continue;
            }
            const col = ax === 0 ? t.plane.color : AXIS_COLORS[ax];
            parts.push(
              `<line x1="${as[0]}" y1="${as[1]}" x2="${ts[0]}" y2="${ts[1]}" stroke="${col}" stroke-width="2.5" ${ax === 0 ? 'stroke-dasharray="4 3"' : ''} />`,
              `<circle data-h="pmove:${ax}" cx="${ts[0]}" cy="${ts[1]}" r="7" fill="${col}" style="pointer-events:auto;cursor:grab" />`,
            );
          }
        }
        parts.push(`<circle cx="${as[0]}" cy="${as[1]}" r="3" fill="${t.plane.color}" />`);
      }
    }

    const html = parts.join('');
    if (this.svg.innerHTML !== html) {
      this.svg.innerHTML = html;
      for (const el of this.svg.querySelectorAll('[data-h]')) {
        (el as SVGElement).addEventListener('pointerdown', (ev) => {
          const e = ev as PointerEvent;
          e.stopPropagation();
          e.preventDefault();
          this.beginDrag((el.getAttribute('data-h') ?? '').split(':'), e);
        });
      }
    }
  }

  private beginDrag([kind, axisStr, dirStr]: string[], e: PointerEvent) {
    const axis = Number(axisStr);
    const fdir = (Number(dirStr) >= 0 ? 1 : -1) as 1 | -1;
    const t = this.targets();
    const [mx, my] = this.localXY(e);
    const ray = this.renderer.screenRay(mx, my);
    if (!ray) {
      return;
    }

    if (kind === 'srotate' && t.sel) {
      const n = WORLD_AXES[axis];
      const p = rayPlane(ray.origin, ray.dir, t.sel.center, n);
      if (!p) {
        return;
      }
      this.drag = {
        kind: 'srotate',
        axis,
        ringCenter: [...t.sel.center],
        ringNormal: n,
        startVec: sub(p, t.sel.center),
        last: null,
      };
      return;
    }
    if ((kind === 'smove' || kind === 'sscale') && t.sel) {
      const axisDir = WORLD_AXES[axis];
      this.drag = {
        kind: kind as 'smove' | 'sscale',
        axis,
        startParam: closestAxisParam(t.sel.center, axisDir, ray.origin, ray.dir),
        startCenter: [...t.sel.center],
        axisDir,
        radius: this.selRadius(t.sel.center),
        last: null,
      };
      return;
    }
    if (kind === 'rotate' && t.box) {
      const n = quatRotate(t.box.rotation, WORLD_AXES[axis]);
      const p = rayPlane(ray.origin, ray.dir, t.box.center, n);
      if (!p) {
        return;
      }
      this.drag = {
        kind: 'rotate',
        axis,
        ringCenter: [...t.box.center],
        ringNormal: n,
        startVec: sub(p, t.box.center),
        startRotation: [...t.box.rotation],
        startNormal: [0, 0, 1],
      };
      return;
    }
    if (kind === 'protate' && t.plane) {
      const n = WORLD_AXES[axis];
      const p = rayPlane(ray.origin, ray.dir, t.plane.anchor, n);
      if (!p) {
        return;
      }
      this.drag = {
        kind: 'protate',
        axis,
        ringCenter: [...t.plane.anchor],
        ringNormal: n,
        startVec: sub(p, t.plane.anchor),
        startRotation: [0, 0, 0, 1],
        startNormal: [...t.plane.normal],
      };
      return;
    }
    if (kind === 'pmove' && t.plane) {
      const axisDir = planeAxes(t.plane.normal)[axis];
      this.drag = {
        kind: 'pmove',
        axis,
        startParam: closestAxisParam(t.plane.anchor, axisDir, ray.origin, ray.dir),
        startCenter: [...t.plane.anchor],
        startSize: [0, 0, 0],
        axisDir,
      };
      return;
    }
    if (kind === 'face' && t.box) {
      const axisDir = quatRotate(t.box.rotation, WORLD_AXES[axis]);
      this.drag = {
        kind: 'face',
        axis,
        dir: fdir,
        startParam: closestAxisParam(t.box.center, axisDir, ray.origin, ray.dir),
        startCenter: [...t.box.center],
        startSize: [...t.box.size],
        axisDir,
      };
      return;
    }
    if ((kind === 'move' || kind === 'scale') && t.box) {
      const axisDir = quatRotate(t.box.rotation, WORLD_AXES[axis]);
      this.drag = {
        kind: kind as 'move' | 'scale',
        axis,
        startParam: closestAxisParam(t.box.center, axisDir, ray.origin, ray.dir),
        startCenter: [...t.box.center],
        startSize: [...t.box.size],
        axisDir,
      };
    }
  }
}
