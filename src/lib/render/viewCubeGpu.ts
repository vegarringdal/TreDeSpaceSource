// GPU view cube: geometry + label atlas for the canvas-drawn orientation cube.
// Mirrors the DOM ViewGizmo's plate layout EXACTLY (unit cube S=1, centred at
// the origin, world = Z-up CAD space) so the invisible DOM hit zones and the
// rendered cube line up: 6 chamfered faces, 12 edge bevels, 8 corner triangles.
// The DOM gizmo keeps hit-testing/hover/drag; this module only produces what
// the renderer draws (see viewCubeWgsl in shaders.ts).

import type { GizmoFace } from '../overlay/ViewGizmo';
import { gizmoFaceDirections } from '../overlay/ViewGizmo';

/** Chamfer width as a fraction of the cube edge (matches ViewGizmo's S*0.16). */
const C = 0.16;

export const VIEWCUBE_FACES: GizmoFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/** Max reach of any plate from the centre, in cube-edge units — the renderer
 *  expands its viewport by this (×2) so a rotated cube is never clipped. */
export const VIEWCUBE_REACH = (1.5 - 2 * C) / Math.sqrt(3) + C * Math.SQRT2 * 1.14;

type V3 = [number, number, number];

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s];
const add3 = (a: V3, b: V3, c: V3): V3 => [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];

/** In-plane "up" used to keep face labels upright (Z-up, front = −Y). */
const faceUp: Record<GizmoFace, V3> = {
  front: [0, 0, 1],
  back: [0, 0, 1],
  left: [0, 0, 1],
  right: [0, 0, 1],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

// Vertex layout (12 floats / 48 bytes):
//   pos.xyz | zoneId | uv.xy | faceSlot (0..5 label tile, -1 solid) | isBevel
//   | plate normal.xyz | pad
// The normal drives per-fragment facing (dot with the view dir) instead of
// winding-based culling — the cube is tiny, and this can't get the winding wrong.
const FLOATS = 12;

export interface ViewCubeGeometry {
  vertexData: Float32Array;
  vertexCount: number;
  /** DOM pick id (ViewGizmo's `pick.id`) → zone id used for hover highlight. */
  zoneIds: Record<string, number>;
}

export function buildViewCubeGeometry(): ViewCubeGeometry {
  const verts: number[] = [];
  const zoneIds: Record<string, number> = {};
  let nextZone = 0;

  const emit = (p: V3, zone: number, u: number, v: number, faceSlot: number, isBevel: number, n: V3) => {
    verts.push(p[0], p[1], p[2], zone, u, v, faceSlot, isBevel, n[0], n[1], n[2], 0);
  };
  /** Quad centred at `centre`, spanning ±right*hw ±up*hh, facing `n`. */
  const quad = (
    centre: V3,
    right: V3,
    up: V3,
    hw: number,
    hh: number,
    zone: number,
    faceSlot: number,
    bevel: number,
    n: V3,
  ) => {
    // corners in label space: uv (0,0) = top-left
    const tl = add3(centre, scale(right, -hw), scale(up, hh));
    const tr = add3(centre, scale(right, hw), scale(up, hh));
    const br = add3(centre, scale(right, hw), scale(up, -hh));
    const bl = add3(centre, scale(right, -hw), scale(up, -hh));
    emit(tl, zone, 0, 0, faceSlot, bevel, n);
    emit(bl, zone, 0, 1, faceSlot, bevel, n);
    emit(br, zone, 1, 1, faceSlot, bevel, n);
    emit(tl, zone, 0, 0, faceSlot, bevel, n);
    emit(br, zone, 1, 1, faceSlot, bevel, n);
    emit(tr, zone, 1, 0, faceSlot, bevel, n);
  };

  // -- 6 faces ---------------------------------------------------------------
  const faceHalf = (1 - 2 * C) / 2;
  VIEWCUBE_FACES.forEach((face, slot) => {
    const n = gizmoFaceDirections[face];
    const up = faceUp[face];
    const right = norm(cross(up, n));
    zoneIds[face] = nextZone;
    quad(scale(n, 0.5), right, up, faceHalf, faceHalf, nextZone++, slot, 0, n);
  });

  // -- 12 edge bevels (same pairs/order as ViewGizmo) ------------------------
  const bevelHalf = (C * Math.SQRT2) / 2;
  const edgeDist = (1 - C) / Math.SQRT2;
  const pairs: Array<[GizmoFace, GizmoFace]> = [
    ['front', 'right'],
    ['front', 'left'],
    ['back', 'right'],
    ['back', 'left'],
    ['front', 'top'],
    ['front', 'bottom'],
    ['back', 'top'],
    ['back', 'bottom'],
    ['right', 'top'],
    ['right', 'bottom'],
    ['left', 'top'],
    ['left', 'bottom'],
  ];
  for (const [a, b] of pairs) {
    const da = gizmoFaceDirections[a];
    const db = gizmoFaceDirections[b];
    const n = norm([da[0] + db[0], da[1] + db[1], da[2] + db[2]]);
    // the edge LINE direction is ⊥ to both face normals; (along, across, n)
    // must be right-handed like the faces' (right, up, n) or the winding flips
    const along = norm(cross(da, db));
    const across = norm(cross(n, along));
    zoneIds[`${a}+${b}`] = nextZone;
    quad(scale(n, edgeDist), along, across, faceHalf, bevelHalf, nextZone++, -1, 1, n);
  }

  // -- 8 corner triangles ----------------------------------------------------
  const cornerDist = (1.5 - 2 * C) / Math.sqrt(3);
  const tri = C * Math.SQRT2 * 1.14;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const n = norm([sx, sy, sz]);
        const names = [sy < 0 ? 'front' : 'back', sz > 0 ? 'top' : 'bottom', sx > 0 ? 'right' : 'left'];
        // vertex of the triangle points at the top/bottom face (like the CSS roll)
        const worldV: V3 = [0, 0, sz];
        const dot = worldV[0] * n[0] + worldV[1] * n[1] + worldV[2] * n[2];
        const up = norm([worldV[0] - n[0] * dot, worldV[1] - n[1] * dot, worldV[2] - n[2] * dot]);
        const right = norm(cross(up, n));
        const zone = nextZone;
        zoneIds[names.join('+')] = nextZone++;
        const centre = scale(n, cornerDist);
        // apex + base, centroid at plate centre (matches the CSS clip-path)
        const apex = add3(centre, scale(up, tri * 0.5), [0, 0, 0]);
        const bl = add3(centre, scale(up, -tri * 0.25), scale(right, -tri * 0.44));
        const br = add3(centre, scale(up, -tri * 0.25), scale(right, tri * 0.44));
        // isBevel = 2: solid colour AND no inset border (uv is the pre-clip square)
        const e = (p: V3, u: number, v: number) => emit(p, zone, u, v, -1, 2, n);
        e(apex, 0.5, 0);
        e(bl, 0.06, 0.75);
        e(br, 0.94, 0.75);
      }
    }
  }

  return { vertexData: new Float32Array(verts), vertexCount: verts.length / FLOATS, zoneIds };
}

/** Tile size of the label atlas (6 tiles side by side, one per face). */
export const ATLAS_TILE = 128;

/** Render the 6 face labels into a 6×1 tile strip (ImageBitmap-compatible). */
export function buildLabelAtlas(
  labels: Partial<Record<GizmoFace, string>> = {},
  textColor = '#c9cfd8', // ViewGizmo COL.text
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(ATLAS_TILE * 6, ATLAS_TILE);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const MAX_LABEL_CHARS = 5; // matches ViewGizmo — cap + uniform sizing
  const defaults: Record<GizmoFace, string> = {
    front: 'FRONT',
    back: 'BACK',
    left: 'LEFT',
    right: 'RIGHT',
    top: 'TOP',
    bottom: 'BOT',
  };
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // uniform size across faces (matches ViewGizmo.faceFont): always sized to the
  // char cap, so a short label and a full-length one render at the same height
  const px = Math.max(12, (ATLAS_TILE * 1.15) / MAX_LABEL_CHARS);
  ctx.font = `700 ${px}px ui-sans-serif, system-ui, sans-serif`;
  VIEWCUBE_FACES.forEach((face, slot) => {
    const text = (labels[face] ?? defaults[face]).slice(0, MAX_LABEL_CHARS);
    ctx.fillText(text, slot * ATLAS_TILE + ATLAS_TILE / 2, ATLAS_TILE / 2, ATLAS_TILE * 0.9);
  });
  return canvas;
}
