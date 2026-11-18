// Canvas 2D painting of the axis-ball gizmo and the cube's north marker.
// ViewCubePass paints into an offscreen canvas the size of the gizmo's mini
// viewport and blits it over the frame, so captures include it. Layout comes
// from axisGizmo.ts — the same numbers the DOM hit layer picks with.
import type { GizmoFace } from '../overlay/ViewGizmo';
import { type AxisItem, BALL_RADIUS, DOT_RADIUS, MARKER_CHIP } from './axisGizmo';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type Ctx2D = OffscreenCanvasRenderingContext2D;

/** The cube palette as CSS colours (sketch mode passes its own). */
export type GizmoPalette = Readonly<{ face: string; line: string; text: string; hover: string }>;

export type AxisPaintOptions = Readonly<{
  /** Gizmo centre in canvas px. */
  cx: number;
  cy: number;
  /** Canvas px per cube edge. */
  scale: number;
  letters: Readonly<Record<GizmoFace, string>>;
  /** AxisItem id under the pointer, or ''. */
  hoverId: string;
  palette: GizmoPalette;
}>;

export type MarkerPaintOptions = Readonly<{
  x: number;
  y: number;
  scale: number;
  label: string;
  /** The pointer triangle in canvas px: tip, then the two base corners. */
  pointer: readonly Readonly<{ x: number; y: number }>[];
  /** Behind the cube's centre: drawn faint so the cube reads in front. */
  isBehind: boolean;
  isHover: boolean;
  palette: GizmoPalette;
}>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const AXIS_COLORS = { X: '#e0475b', Y: '#7cb342', Z: '#3b82e0' } as const satisfies Record<string, string>;
export const NORTH_COLOR = '#e0a63b';
const NEGATIVE_FILL_ALPHA = '59'; // ≈35 % as a hex alpha byte
const POSITIVE_TEXT = '#14181e';
const NEGATIVE_TEXT = '#eef1f5';
const HOVER_RING = '#ffffff';
const DOT_OUTLINE = 'rgba(20,24,30,0.75)';
const BEHIND_ALPHA = 0.45;
const FONT = 'ui-sans-serif, system-ui, sans-serif';

// -----------------------------------------------------------------------------
// painting
// -----------------------------------------------------------------------------

function paintBall(ctx: Ctx2D, it: AxisItem, o: AxisPaintOptions, x: number, y: number) {
  const ball = it.ball;
  if (!ball) {
    return;
  }
  const color = AXIS_COLORS[ball.axis];
  const r = BALL_RADIUS * o.scale;
  const isPositive = ball.sign > 0;
  if (isPositive) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, o.scale * 0.035);
    ctx.beginPath();
    ctx.moveTo(o.cx, o.cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = isPositive ? color : `${color}${NEGATIVE_FILL_ALPHA}`;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, o.scale * 0.022);
  ctx.strokeStyle = o.hoverId === it.id ? HOVER_RING : color;
  ctx.stroke();
  const text = o.letters[ball.face];
  if (text) {
    ctx.fillStyle = isPositive ? POSITIVE_TEXT : NEGATIVE_TEXT;
    ctx.font = `700 ${text.length > 1 ? r * 0.95 : r * 1.2}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + r * 0.05);
  }
}

function paintDot(ctx: Ctx2D, it: AxisItem, o: AxisPaintOptions, x: number, y: number) {
  const isHover = o.hoverId === it.id;
  ctx.globalAlpha = it.alpha;
  ctx.beginPath();
  ctx.arc(x, y, DOT_RADIUS * o.scale * (isHover ? 1.45 : 1), 0, Math.PI * 2);
  ctx.fillStyle = isHover ? HOVER_RING : o.palette.text;
  ctx.fill();
  ctx.lineWidth = Math.max(1, o.scale * 0.014);
  ctx.strokeStyle = DOT_OUTLINE;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The six balls (+ the revealed snap dots), back to front as laid out. */
export function paintAxisGizmo(ctx: Ctx2D, items: readonly AxisItem[], o: AxisPaintOptions) {
  for (const it of items) {
    const x = o.cx + it.x * o.scale;
    const y = o.cy + it.y * o.scale;
    if (it.kind === 'ball') {
      paintBall(ctx, it, o, x, y);
    } else {
      paintDot(ctx, it, o, x, y);
    }
  }
}

/** The cube's true-north marker: an amber pointer triangle aimed at north,
 *  and a small square chip with an amber border and the letter. */
export function paintNorthMarker(ctx: Ctx2D, o: MarkerPaintOptions) {
  const s = MARKER_CHIP * o.scale;
  ctx.globalAlpha = o.isBehind ? BEHIND_ALPHA : 1;
  if (o.pointer.length === 3) {
    ctx.fillStyle = NORTH_COLOR;
    ctx.beginPath();
    ctx.moveTo(o.pointer[0].x, o.pointer[0].y);
    ctx.lineTo(o.pointer[1].x, o.pointer[1].y);
    ctx.lineTo(o.pointer[2].x, o.pointer[2].y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = o.isHover ? o.palette.hover : o.palette.face;
  ctx.fillRect(o.x - s / 2, o.y - s / 2, s, s);
  ctx.lineWidth = Math.max(1.5, o.scale * 0.02);
  ctx.strokeStyle = NORTH_COLOR;
  ctx.strokeRect(o.x - s / 2, o.y - s / 2, s, s);
  ctx.fillStyle = NORTH_COLOR;
  ctx.font = `700 ${o.label.length > 1 ? s * 0.48 : s * 0.62}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(o.label, o.x, o.y + s * 0.04);
  ctx.globalAlpha = 1;
}
