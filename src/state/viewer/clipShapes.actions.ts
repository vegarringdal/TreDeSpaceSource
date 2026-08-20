// Clip-shape actions — add/fit/edit/gizmo/save/load, mirroring the native
// shapes_panel (ribbon/clipping.rs): default placement, fit-to-AABB, and the
// ShapeSet JSON format (shapes + muted + helpers).
import { downloadText } from '../../lib/download';
import type { Quat, V3 } from '../../lib/math/quat';
import {
  type ClipShape,
  type ClipShapeKind,
  clipShapesState,
  MAX_CLIP_SHAPES,
  SHAPE_LABEL,
  supportsRotate,
} from './clipShapes.state';

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
};

/** Default placement for a freshly added shape (native default_shape): sphere
 *  at the centre; cylinder standing under it; box as a half-extent cube. */
function defaultShape(kind: ClipShapeKind, id: number, n: number, center: V3, radius: number): ClipShape {
  const base: ClipShape = {
    id,
    kind,
    label: `${SHAPE_LABEL[kind]} ${n}`,
    center,
    axis: [0, 0, 1],
    radius,
    height: 0,
    halfExtents: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    enabled: true,
    inverted: false,
    showHelper: true,
  };
  if (kind === 'cylinder') {
    return {
      ...base,
      center: [center[0], center[1], center[2] - radius],
      radius: radius * 0.5,
      height: Math.max(radius * 2, 0.02),
    };
  }
  if (kind === 'box') {
    const h = Math.max(radius, 0.01);
    return { ...base, radius: 0, halfExtents: [h, h, h] };
  }
  return base;
}

/** Fit a shape to an AABB expanded by `padM` metres (native fit_shape). */
export function fitShape(s: ClipShape, mnIn: V3, mxIn: V3, padM: number): ClipShape {
  const mn: V3 = [mnIn[0] - padM, mnIn[1] - padM, mnIn[2] - padM];
  const mx: V3 = [mxIn[0] + padM, mxIn[1] + padM, mxIn[2] + padM];
  const c: V3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const ext: V3 = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const extLen = Math.hypot(...ext);
  if (s.kind === 'sphere') {
    return { ...s, center: c, radius: Math.max(extLen * 0.5, 0.01) };
  }
  if (s.kind === 'cylinder') {
    const a = norm(s.axis);
    // support width of the AABB along the axis = height; enclosing radius from
    // the remaining (perpendicular) extent
    const w = ext[0] * Math.abs(a[0]) + ext[1] * Math.abs(a[1]) + ext[2] * Math.abs(a[2]);
    const height = Math.max(w, 0.01);
    const perp = Math.sqrt(Math.max(extLen * extLen - w * w, 0));
    return {
      ...s,
      axis: a,
      height,
      radius: Math.max(perp * 0.5, 0.01),
      center: [c[0] - a[0] * (height / 2), c[1] - a[1] * (height / 2), c[2] - a[2] * (height / 2)],
    };
  }
  return {
    ...s,
    center: c,
    halfExtents: [Math.max(ext[0] / 2, 0.01), Math.max(ext[1] / 2, 0.01), Math.max(ext[2] / 2, 0.01)],
    rotation: [0, 0, 0, 1] as Quat, // axis-aligned fit
  };
}

export const clipShapesActions = {
  /** Add a shape at `center` (fit the caller's AABB via fitTo when provided —
   *  the native "fit selected on add"). Returns the new id, or null when full. */
  add(kind: ClipShapeKind, center: V3 = [0, 0, 0], radius = 5, fitTo?: { mn: V3; mx: V3 }): number | null {
    let newId: number | null = null;
    clipShapesState.set((s) => {
      if (s.shapes.length >= MAX_CLIP_SHAPES) {
        return s;
      }
      const n = s.shapes.filter((x) => x.kind === kind).length + 1;
      let sh = defaultShape(kind, s.nextId + 1, n, center, radius);
      if (fitTo) {
        sh = fitShape(sh, fitTo.mn, fitTo.mx, 0);
      }
      newId = sh.id;
      return { shapes: [...s.shapes, sh], nextId: s.nextId + 1 };
    });
    return newId;
  },

  remove(id: number) {
    clipShapesState.set((s) => ({
      shapes: s.shapes.filter((x) => x.id !== id),
      gizmoId: s.gizmoId === id ? null : s.gizmoId,
    }));
  },

  clear() {
    clipShapesState.set({ shapes: [], gizmoId: null });
  },

  update(id: number, patch: Partial<ClipShape>) {
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  },

  /** Fit one shape to an AABB (Fit Sel / Fit +2m buttons). */
  fit(id: number, mn: V3, mx: V3, padM: number) {
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => (x.id === id ? fitShape(x, mn, mx, padM) : x)),
    }));
  },

  /** Re-centre a shape on an AABB centre without resizing (Center button). */
  centerOn(id: number, mn: V3, mx: V3) {
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => {
        if (x.id !== id) {
          return x;
        }
        const c: V3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
        if (x.kind === 'cylinder') {
          const a = norm(x.axis);
          const h = x.height / 2;
          return { ...x, center: [c[0] - a[0] * h, c[1] - a[1] * h, c[2] - a[2] * h] };
        }
        return { ...x, center: c };
      }),
    }));
  },

  toggleEnabled: (id: number) =>
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
    })),
  toggleInverted: (id: number) =>
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => (x.id === id ? { ...x, inverted: !x.inverted } : x)),
    })),
  toggleHelper: (id: number) =>
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => (x.id === id ? { ...x, showHelper: !x.showHelper } : x)),
    })),

  toggleMuted: () => clipShapesState.set((s) => ({ muted: !s.muted })),
  toggleHelpers: () => clipShapesState.set((s) => ({ helpers: !s.helpers })),

  /** Arm/disarm the viewport gizmo on a shape (per-row Gizmo toggle). */
  armGizmo(id: number | null) {
    clipShapesState.set((s) => {
      if (id === null) {
        return { gizmoId: null };
      }
      const sh = s.shapes.find((x) => x.id === id);
      // clamp Rotate off when the armed shape can't rotate (native behaviour)
      const gizmoMode = s.gizmoMode === 'rotate' && sh && !supportsRotate(sh.kind) ? 'move' : s.gizmoMode;
      return { gizmoId: s.gizmoId === id ? null : id, gizmoMode };
    });
  },

  setGizmoMode(mode: 'move' | 'rotate' | 'scale') {
    clipShapesState.set((s) => {
      const sh = s.shapes.find((x) => x.id === s.gizmoId);
      if (mode === 'rotate' && sh && !supportsRotate(sh.kind)) {
        return s;
      }
      return { gizmoMode: mode };
    });
  },

  /** Bump a numeric field on a shape (drives the +/- steppers). */
  bump(id: number, field: 'radius' | 'height', delta: number) {
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) =>
        x.id === id ? { ...x, [field]: Math.max(0.01, +(x[field] + delta).toFixed(3)) } : x,
      ),
    }));
  },

  /** Nudge one axis of the centre. */
  bumpCenter(id: number, axis: 0 | 1 | 2, delta: number) {
    clipShapesState.set((s) => ({
      shapes: s.shapes.map((x) => {
        if (x.id !== id) {
          return x;
        }
        const center: V3 = [...x.center];
        center[axis] = +(center[axis] + delta).toFixed(3);
        return { ...x, center };
      }),
    }));
  },

  // -----------------------------------------------------------------------------
  // share: save / load a ShapeSet as JSON (native ShapeSet format)
  // -----------------------------------------------------------------------------
  exportJson(): string {
    const s = clipShapesState.get();
    return JSON.stringify({ shapes: s.shapes, muted: s.muted, helpers: s.helpers }, null, 2);
  },

  downloadJson() {
    downloadText('clip_shapes.json', this.exportJson());
  },

  /** Load a ShapeSet, replacing the current one. Returns the count. */
  importJson(text: string): number {
    const data = JSON.parse(text) as { shapes?: ClipShape[]; muted?: boolean; helpers?: boolean };
    const shapes = (data.shapes ?? []).filter((x) => x && typeof x.kind === 'string').slice(0, MAX_CLIP_SHAPES);
    let nextId = 0;
    for (const [i, x] of shapes.entries()) {
      x.id = x.id ?? i + 1;
      x.label = x.label ?? '';
      x.axis = x.axis ?? [0, 0, 1];
      x.halfExtents = x.halfExtents ?? [1, 1, 1];
      x.rotation = x.rotation ?? [0, 0, 0, 1];
      x.enabled = x.enabled ?? true;
      x.inverted = x.inverted ?? false;
      x.showHelper = x.showHelper ?? true;
      nextId = Math.max(nextId, x.id);
    }
    clipShapesState.set({
      shapes,
      muted: data.muted ?? false,
      helpers: data.helpers ?? true,
      gizmoId: null,
      nextId,
    });
    return shapes.length;
  },

  /** APPEND validated shapes to the current set (host API `clip.shapes.add`).
   *  Each shape's fields are defaulted like importJson; ids are re-assigned so
   *  they never collide with existing ones. Returns how many were added. */
  addShapes(input: Partial<ClipShape>[]): number {
    const valid = input.filter((x) => x && typeof x.kind === 'string');
    let added = 0;
    clipShapesState.set((s) => {
      const room = MAX_CLIP_SHAPES - s.shapes.length;
      if (room <= 0) {
        return s;
      }
      let nextId = s.nextId;
      const extra: ClipShape[] = valid.slice(0, room).map((x) => {
        nextId += 1;
        return {
          kind: x.kind as ClipShape['kind'],
          id: nextId,
          label: x.label ?? '',
          center: x.center ?? [0, 0, 0],
          axis: x.axis ?? [0, 0, 1],
          radius: x.radius ?? 5,
          height: x.height ?? 10,
          halfExtents: x.halfExtents ?? [1, 1, 1],
          rotation: x.rotation ?? [0, 0, 0, 1],
          enabled: x.enabled ?? true,
          inverted: x.inverted ?? false,
          showHelper: x.showHelper ?? true,
        };
      });
      added = extra.length;
      return { shapes: [...s.shapes, ...extra], nextId };
    });
    return added;
  },
};
