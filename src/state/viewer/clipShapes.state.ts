// Additional shader-evaluated clip shapes — sphere / cylinder / box — ported
// from the native ClipShape/ShapeSet (clip_state.rs). The default clip *box*
// keeps its dedicated oriented-box slot + ribbon; these are extra volumes with
// native combine semantics: inverted shapes are holes (each cuts its inside),
// normal shapes are keep-volumes (UNION — a fragment survives inside ANY).
import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { Quat, V3 } from '../../lib/math/quat';

export type ClipShapeKind = 'sphere' | 'cylinder' | 'box';

export const SHAPE_LABEL: Record<ClipShapeKind, string> = {
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  box: 'Box',
};

/** User-shape cap: the shader has 8 fixed slots, slot 0 is reserved for the
 *  DEFAULT clip box (native clip.rs packs it the same way). */
export const MAX_CLIP_SHAPES = 7;

/** Whether the gizmo's rotate mode is meaningful (a sphere has no orientation). */
export function supportsRotate(kind: ClipShapeKind): boolean {
  return kind !== 'sphere';
}

export interface ClipShape {
  id: number;
  kind: ClipShapeKind;
  label: string;
  /** Sphere/box centre; cylinder BASE point (native convention). */
  center: V3;
  /** Cylinder axis (unit); unused for sphere/box. */
  axis: V3;
  radius: number;
  /** Cylinder length along `axis`; unused for sphere/box. */
  height: number;
  /** Box half-extents; unused for sphere/cylinder. */
  halfExtents: V3;
  /** Box orientation (gizmo-rotated); identity = axis-aligned. */
  rotation: Quat;
  enabled: boolean;
  /** Clip inside the shape instead of outside (a hole). */
  inverted: boolean;
  /** Show this shape's outline helper in the viewport. */
  showHelper: boolean;
}

/** The point the shape gizmo anchors at (sphere/box centre; cylinder mid). */
export function gizmoCenter(s: ClipShape): V3 {
  if (s.kind !== 'cylinder') {
    return s.center;
  }
  const l = Math.hypot(s.axis[0], s.axis[1], s.axis[2]) || 1;
  const h = s.height * 0.5;
  return [s.center[0] + (s.axis[0] / l) * h, s.center[1] + (s.axis[1] / l) * h, s.center[2] + (s.axis[2] / l) * h];
}

export function displayName(s: ClipShape): string {
  return s.label || SHAPE_LABEL[s.kind];
}

export interface ClipShapesState {
  shapes: ClipShape[];
  /** Global mute — disables every shape (per-shape `enabled` preserved). */
  muted: boolean;
  /** Global toggle for the outline helpers. */
  helpers: boolean;
  /** Shape id the viewport gizmo is armed on (null = none). */
  gizmoId: number | null;
  gizmoMode: 'move' | 'rotate' | 'scale';
  nextId: number;
}

export const clipShapesState = createStore<ClipShapesState>({
  shapes: [],
  muted: false,
  helpers: true,
  gizmoId: null,
  gizmoMode: 'move',
  nextId: 0,
});
