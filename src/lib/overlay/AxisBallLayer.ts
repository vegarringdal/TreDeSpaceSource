// The axis balls' hit layer: one invisible circle over the gizmo stage that
// picks with the same layout the renderer paints (render/axisGizmo.ts) —
// hover, click (view from / Shift = opposite), drag to orbit. The snap dots
// only count while revealed: pointer over the gizmo, or for a few seconds
// after a tap on touch, which has no hover.
import {
  AXIS_REACH,
  type AxisItem,
  type GizmoBasis,
  layoutAxisGizmo,
  pickAxisGizmo,
  type SnapDotSet,
} from '../render/axisGizmo';
import type { GizmoPick } from './ViewGizmo';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface AxisBallLayerOptions {
  onPick?: (pick: GizmoPick) => void;
  onHover?: (pick: GizmoPick | null) => void;
  /** A drag on the balls: orbit the camera by this many CSS px. */
  onOrbit?: (dx: number, dy: number) => void;
}

type Press = { x: number; y: number; lastX: number; lastY: number; slop: number; isDrag: boolean };

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const MOUSE_SLOP_PX = 3;
const TOUCH_SLOP_PX = 10;
/** The gizmo is small; a drag on it turns the camera faster than one on the canvas. */
const ORBIT_GAIN = 2;
const TOUCH_REVEAL_MS = 3000;
const IDENTITY: GizmoBasis = { right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0] };

// -----------------------------------------------------------------------------
// layer
// -----------------------------------------------------------------------------

export class AxisBallLayer {
  private readonly el: HTMLDivElement;
  private basis: GizmoBasis = IDENTITY;
  private snapDots: SnapDotSet = 'iso';
  private isHovering = false;
  private revealUntil = 0;
  private press: Press | null = null;
  private wasDrag = false;
  private hoverId = '';
  private readonly size: number;
  private readonly opts: AxisBallLayerOptions;

  constructor(stage: HTMLElement, size: number, opts: AxisBallLayerOptions) {
    this.size = size;
    this.opts = opts;
    const d = 2 * AXIS_REACH * size;
    this.el = document.createElement('div');
    this.el.dataset.gizmoPick = 'axis-balls';
    Object.assign(this.el.style, {
      position: 'absolute',
      left: `${size / 2 - d / 2}px`,
      top: `${size / 2 - d / 2}px`,
      width: `${d}px`,
      height: `${d}px`,
      borderRadius: '50%',
      display: 'none',
      touchAction: 'none',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.addEventListener('pointermove', this.handleMove);
    this.el.addEventListener('pointerleave', this.handleLeave);
    this.el.addEventListener('pointerdown', this.handleDown);
    this.el.addEventListener('pointerup', this.handleUp);
    this.el.addEventListener('pointercancel', this.handleUp);
    this.el.addEventListener('click', this.handleClick);
    stage.appendChild(this.el);
  }

  /** Shown for the balls style, hidden (and hover cleared) for the cube. */
  setActive(isActive: boolean) {
    this.el.style.display = isActive ? '' : 'none';
    if (!isActive) {
      this.isHovering = false;
      this.setHover(null);
    }
  }

  setSnapDots(set: SnapDotSet) {
    this.snapDots = set;
  }

  /** The camera's gizmo basis this frame (picking follows the drawing). */
  update(basis: GizmoBasis) {
    this.basis = basis;
  }

  /** The snap dots should show: pointer over the balls, or a recent tap. */
  isRevealed(now: number): boolean {
    return this.isHovering || now < this.revealUntil;
  }

  dispose() {
    this.el.remove();
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private pickAt(clientX: number, clientY: number): AxisItem | null {
    const r = this.el.getBoundingClientRect();
    const x = (clientX - (r.left + r.width / 2)) / this.size;
    const y = (clientY - (r.top + r.height / 2)) / this.size;
    const reveal = this.isRevealed(performance.now()) ? 1 : 0;
    return pickAxisGizmo(layoutAxisGizmo(this.basis, this.snapDots, reveal), x, y);
  }

  private toPick(item: AxisItem): GizmoPick {
    return { kind: item.kind === 'ball' ? 'ball' : 'snap', id: item.id, direction: [...item.dir] };
  }

  private setHover(item: AxisItem | null) {
    const id = item?.id ?? '';
    if (id === this.hoverId) {
      return;
    }
    this.hoverId = id;
    this.opts.onHover?.(item ? this.toPick(item) : null);
  }

  // ---------------------------------------------------------------------------
  // event handlers
  // ---------------------------------------------------------------------------

  private handleMove = (e: PointerEvent) => {
    const p = this.press;
    if (!p) {
      this.isHovering = e.pointerType !== 'touch';
      this.setHover(this.pickAt(e.clientX, e.clientY));
      return;
    }
    if (!p.isDrag && Math.hypot(e.clientX - p.x, e.clientY - p.y) > p.slop) {
      p.isDrag = true;
      this.setHover(null);
    }
    if (p.isDrag) {
      this.opts.onOrbit?.((e.clientX - p.lastX) * ORBIT_GAIN, (e.clientY - p.lastY) * ORBIT_GAIN);
    }
    p.lastX = e.clientX;
    p.lastY = e.clientY;
  };

  private handleLeave = () => {
    if (this.press) {
      return;
    }
    this.isHovering = false;
    this.setHover(null);
  };

  private handleDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    this.el.setPointerCapture(e.pointerId);
    const slop = e.pointerType === 'touch' ? TOUCH_SLOP_PX : MOUSE_SLOP_PX;
    this.press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, slop, isDrag: false };
  };

  private handleUp = () => {
    this.wasDrag = this.press?.isDrag ?? false;
    this.press = null;
  };

  /** A tap or click (not a drag) picks; on touch it also shows the dots for a while. */
  private handleClick = (e: MouseEvent) => {
    if (this.wasDrag) {
      this.wasDrag = false;
      return;
    }
    const item = this.pickAt(e.clientX, e.clientY);
    if (item) {
      this.opts.onPick?.({ ...this.toPick(item), isShift: e.shiftKey });
    }
    const isTouch = e instanceof PointerEvent && e.pointerType === 'touch';
    if (isTouch) {
      this.revealUntil = performance.now() + TOUCH_REVEAL_MS;
    }
  };
}
