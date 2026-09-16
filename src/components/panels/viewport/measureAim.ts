// Touch aiming for the measurement tools — the "press-and-hold loupe".
//
// A finger covers exactly the pixel it is trying to place, and a touch device
// has no hover, so a plain tap places a point blind. Holding still for HOLD_MS
// instead takes the touch away from the camera and raises a crosshair
// OFFSET_PX above the contact point: the crosshair IS the placement point, the
// live snap probe under it feeds the usual rubber-band/snap-glyph preview,
// dragging nudges it, and lifting places it. A drag that starts before the
// hold elapses stays an ordinary camera orbit and places nothing.
import type { CameraController } from '../../../lib/render/camera';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { type MeasureHit, measurementsState } from '../../../state/viewer/measurements.state';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface MeasureAimDeps {
  /** The panel host (position:relative) the crosshair overlay is added to. */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: CameraController;
  /** Snap probe, in canvas CSS pixels. */
  probe: (x: number, y: number) => Promise<MeasureHit | null>;
}

export interface MeasureAim {
  /** The crosshair is up: the viewport's own hover probe must stand down, or it
   *  would overwrite the preview with the position of the finger instead of the
   *  crosshair's. */
  aiming(): boolean;
  /** True once per gesture that placed a point — the trailing `click` must be
   *  ignored so the point is not placed twice. Reading it clears it. */
  consumedClick(): boolean;
  dispose(): void;
}

type Pt = { x: number; y: number };

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Hold this long without moving to raise the crosshair. The platform
 *  long-press duration on purpose: shorter and a merely slow tap enters aim
 *  mode by accident, placing the point at the crosshair rather than under the
 *  finger. */
const HOLD_MS = 450;
/** Finger travel that turns the hold into a camera drag instead. */
const SLOP_PX = 10;
/** How far above the finger the crosshair sits — clear of the contact patch. */
const OFFSET_PX = 56;
/** Keep the crosshair this far inside the viewport. */
const EDGE_PAD = 10;
const HAPTIC_MS = 10;

/** Snap-kind tint, matching MeasureOverlay's snap glyphs. */
const KIND_COL: Record<MeasureHit['kind'], string> = {
  corner: '#ff7878',
  edge: '#ffd25a',
  face: '#50e6ff',
};
/** Off-surface: the crosshair still tracks, but nothing will be placed. */
const MISS_COL = '#ffffff';

// -----------------------------------------------------------------------------
// drawing
// -----------------------------------------------------------------------------

const r1 = (v: number): string => v.toFixed(1);

const line = (a: Pt, b: Pt, col: string, w: number, dash = ''): string =>
  `<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke="${col}" stroke-width="${w}"` +
  ` stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

const ring = (c: Pt, r: number, col: string, w: number): string =>
  `<circle cx="${r1(c.x)}" cy="${r1(c.y)}" r="${r}" fill="none" stroke="${col}" stroke-width="${w}"/>`;

/** Crosshair at `aim` with a leader back to the finger. Every stroke is drawn
 *  twice — a wide translucent black halo first — so it stays readable over
 *  both a white drawing and a dark shaded model. */
function aimSvg(aim: Pt, finger: Pt, col: string): string {
  const ticks: [Pt, Pt][] = [
    [
      { x: aim.x - 22, y: aim.y },
      { x: aim.x - 7, y: aim.y },
    ],
    [
      { x: aim.x + 7, y: aim.y },
      { x: aim.x + 22, y: aim.y },
    ],
    [
      { x: aim.x, y: aim.y - 22 },
      { x: aim.x, y: aim.y - 7 },
    ],
    [
      { x: aim.x, y: aim.y + 7 },
      { x: aim.x, y: aim.y + 22 },
    ],
  ];
  let halo = line(finger, aim, '#000000', 5, '5 4');
  let main = line(finger, aim, 'rgba(255,255,255,0.6)', 2, '5 4');
  halo += ring(finger, 17, '#000000', 5) + ring(aim, 14, '#000000', 5);
  main += ring(finger, 17, 'rgba(255,255,255,0.45)', 1.5) + ring(aim, 14, col, 2);
  for (const [a, b] of ticks) {
    halo += line(a, b, '#000000', 5);
    main += line(a, b, col, 2);
  }
  return `<g stroke-opacity="0.5">${halo}</g>${main}`;
}

// -----------------------------------------------------------------------------
// controller
// -----------------------------------------------------------------------------

/**
 * Wire the press-and-hold aim gesture onto the viewport canvas. Only touch
 * pointers are considered, and only while a measure tool is armed; everything
 * else falls through to the camera and the viewport's own click handling.
 */
export function attachMeasureAim({ host, canvas, camera, probe }: MeasureAimDeps): MeasureAim {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:7;display:none';
  host.appendChild(svg);

  const abort = new AbortController();
  const { signal } = abort;

  let holdTimer: number | null = null;
  let holdId = -1;
  let holdAt: Pt = { x: 0, y: 0 };
  let aimId = -1;
  let aim: Pt = { x: 0, y: 0 };
  let finger: Pt = { x: 0, y: 0 };
  let bounds = { w: 1, h: 1 };
  let hit: MeasureHit | null = null;
  let busy = false;
  let consumed = false;
  let lastHtml = '';

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  const draw = () => {
    const html = aimSvg(aim, finger, hit ? KIND_COL[hit.kind] : MISS_COL);
    if (html !== lastHtml) {
      svg.innerHTML = html;
      lastHtml = html;
    }
  };

  const clampAim = () => {
    aim.x = Math.min(Math.max(aim.x, EDGE_PAD), bounds.w - EDGE_PAD);
    aim.y = Math.min(Math.max(aim.y, EDGE_PAD), bounds.h - EDGE_PAD);
  };

  /** One probe at a time; the trailing position is picked up by the next move. */
  const refresh = () => {
    if (busy || aimId === -1) {
      return;
    }
    busy = true;
    const at = { ...aim };
    void probe(at.x, at.y).then((p) => {
      busy = false;
      if (aimId === -1) {
        return;
      }
      hit = p;
      measurementsActions.setHover(p);
      draw();
    });
  };

  const cancelHold = () => {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    holdId = -1;
  };

  const leaveAim = () => {
    if (aimId === -1) {
      return;
    }
    camera.releasePointer(aimId);
    aimId = -1;
    hit = null;
    lastHtml = '';
    svg.style.display = 'none';
    measurementsActions.setHover(null);
  };

  const enterAim = (pointerId: number, at: Pt) => {
    const r = canvas.getBoundingClientRect();
    bounds = { w: r.width, h: r.height };
    finger = { x: at.x - r.left, y: at.y - r.top };
    // above the finger, flipped below when there is no room up there
    aim = { x: finger.x, y: finger.y - OFFSET_PX };
    if (aim.y < EDGE_PAD) {
      aim.y = finger.y + OFFSET_PX;
    }
    clampAim();
    aimId = pointerId;
    hit = null;
    camera.claimPointer(pointerId);
    svg.style.display = 'block';
    draw();
    refresh();
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(HAPTIC_MS);
    }
  };

  /** Lift: re-probe the final crosshair position and commit that point. */
  const placeAndLeave = () => {
    const at = { ...aim };
    leaveAim();
    void probe(at.x, at.y).then((p) => {
      if (p) {
        measurementsActions.addPoint(p);
      }
    });
  };

  // ---------------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------------

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      consumed = false;
      if (e.pointerType !== 'touch') {
        return;
      }
      // a second finger means the user wants to navigate, not to aim
      if (aimId !== -1 || holdId !== -1) {
        cancelHold();
        leaveAim();
        return;
      }
      if (!measurementsState.get().activeKind) {
        return;
      }
      holdId = e.pointerId;
      holdAt = { x: e.clientX, y: e.clientY };
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        const id = holdId;
        holdId = -1;
        if (measurementsState.get().activeKind) {
          enterAim(id, holdAt);
        }
      }, HOLD_MS);
    },
    { signal },
  );

  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId === holdId) {
        if (Math.hypot(e.clientX - holdAt.x, e.clientY - holdAt.y) > SLOP_PX) {
          cancelHold(); // it is a camera drag after all
        }
        return;
      }
      if (e.pointerId !== aimId) {
        return;
      }
      const r = canvas.getBoundingClientRect();
      const now = { x: e.clientX - r.left, y: e.clientY - r.top };
      aim.x += now.x - finger.x;
      aim.y += now.y - finger.y;
      finger = now;
      clampAim();
      draw();
      refresh();
    },
    { signal },
  );

  canvas.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerId === holdId) {
        cancelHold();
        return;
      }
      if (e.pointerId !== aimId) {
        return;
      }
      consumed = true; // synchronous: the trailing click fires before the probe
      placeAndLeave();
    },
    { signal },
  );

  canvas.addEventListener(
    'pointercancel',
    (e) => {
      if (e.pointerId === holdId) {
        cancelHold();
      }
      if (e.pointerId === aimId) {
        leaveAim();
      }
    },
    { signal },
  );

  return {
    aiming(): boolean {
      return aimId !== -1;
    },
    consumedClick(): boolean {
      const was = consumed;
      consumed = false;
      return was;
    },
    dispose() {
      cancelHold();
      leaveAim();
      abort.abort();
      svg.remove();
    },
  };
}
