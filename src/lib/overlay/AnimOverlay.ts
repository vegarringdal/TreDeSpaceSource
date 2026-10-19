// -----------------------------------------------------------------------------
// animation overlay layer (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// The 2D overlays drawn over the viewport. ONE root <svg> sits directly under
// the viewport host, so the screenshot compositor (which rasterizes every
// `:scope > svg`) captures the overlays exactly as shown, at full capture
// resolution. Each instance is a <g>: an optional leader line + anchor dot
// and the card itself — inline-styled HTML in a <foreignObject>, laid out by
// the browser, scaled by an SVG transform (vector, sharp at any size).
// Enter/exit effects are computed from the frame's progress, never from CSS
// transitions, so seeking and frame-stepped capture are exact.

import { render } from 'lit-html';
import { m4TransformPoint, smoothstep } from '../animation/interp';
import { projectToScreen } from '../math/project';
import { keepInView } from './keepInView';
import { renderOverlay } from './overlayTemplate';
import type {
  BindingContext,
  OverlayAnchor,
  OverlayComponent,
  OverlayFrame,
  OverlayInstance,
  OverlayTheme,
  Pin,
  V2,
  V3,
} from './overlayTypes';
import { DEFAULT_LEADER_COLOR } from './overlayTypes';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** What the layer needs to draw one instance. */
export interface ResolvedOverlay {
  instance: OverlayInstance;
  component: OverlayComponent;
  theme: OverlayTheme | null;
}

/** The scene side of the layer: projection, object anchor points, lookups. */
export interface OverlayScene {
  viewProj(): Float32Array;
  /** world point of an object anchor (its pivot at the current pose), or null */
  objectPoint(object: string): V3 | null;
  resolve(instanceId: string): ResolvedOverlay | null;
  bindings(frame: OverlayFrame, instance: OverlayInstance): BindingContext;
  /** attached labels flip / clamp to stay inside the view (D32) */
  keepOnScreen(): boolean;
}

interface Node {
  g: SVGGElement;
  leader: SVGLineElement;
  dot: SVGCircleElement;
  card: SVGGElement;
  fo: SVGForeignObjectElement;
  body: HTMLDivElement;
  size: [number, number];
  observer: ResizeObserver;
  /** the placement drawn last (pos or offset) — a drag starts from it */
  place: V2;
  /** shown in the last frame (display is written only when it changes) */
  shown: boolean;
  /** leader / dot colour drawn last */
  leaderColor: string;
  /** performance.now() when it was last shown — long-unused nodes go */
  lastShown: number;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SLIDE_PX = 48;
/** A card not shown for this long loses its DOM node (made again when needed). */
const NODE_IDLE_MS = 3000;
/** Pin → fraction of the card at the anchor point. */
const PIN_FRAC: Readonly<Record<Pin, [number, number]>> = {
  tl: [0, 0],
  t: [0.5, 0],
  tr: [1, 0],
  l: [0, 0.5],
  c: [0.5, 0.5],
  r: [1, 0.5],
  bl: [0, 1],
  b: [0.5, 1],
  br: [1, 1],
};

// -----------------------------------------------------------------------------
// layer
// -----------------------------------------------------------------------------

export class AnimOverlay {
  /** Fired when a card is dragged (authoring) with the anchor it should get. */
  onMove: ((instance: string, anchor: OverlayAnchor) => void) | null = null;
  /** Fired when in-place text editing commits. */
  onEditText: ((instance: string, param: string, value: string) => void) | null = null;
  /** Fired on a card click (authoring selection). */
  onSelect: ((instance: string) => void) | null = null;

  private readonly host: HTMLElement;
  private readonly scene: OverlayScene;
  private readonly svg: SVGSVGElement;
  private readonly nodes = new Map<string, Node>();
  private interactive = false;
  private selected: string | null = null;
  private editing = false;

  constructor(host: HTMLElement, scene: OverlayScene) {
    this.host = host;
    this.scene = scene;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('data-anim-overlay', '');
    this.svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:6;display:none';
    host.appendChild(this.svg);
  }

  dispose(): void {
    for (const n of this.nodes.values()) {
      n.observer.disconnect();
    }
    this.nodes.clear();
    this.svg.remove();
  }

  /** Authoring: cards take the pointer (drag, double-click edit, select). */
  setInteractive(on: boolean): void {
    this.interactive = on;
    for (const n of this.nodes.values()) {
      n.fo.style.pointerEvents = on ? 'auto' : 'none';
      n.fo.style.cursor = on ? 'grab' : '';
    }
  }

  setSelected(id: string | null): void {
    this.selected = id;
  }

  /** Draw this frame's overlays (empty list or hidden = nothing shown). */
  update(frames: readonly OverlayFrame[], visible: boolean): void {
    this.svg.style.display = visible && frames.length > 0 ? '' : 'none';
    if (!visible) {
      return;
    }
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const vp = this.scene.viewProj();
    const live = new Set<string>();
    for (const f of frames) {
      const r = this.scene.resolve(f.instance);
      if (!r) {
        continue;
      }
      live.add(f.instance);
      const node = this.nodes.get(f.instance) ?? this.create(f.instance);
      if (!this.editing) {
        render(
          renderOverlay(r.component, r.instance.values, r.theme, this.scene.bindings(f, r.instance), {
            editable: this.interactive,
            textScale: r.instance.textScale,
          }),
          node.body,
        );
      }
      this.place(node, r, f, w, h, vp);
    }
    const now = performance.now();
    for (const [id, n] of this.nodes) {
      const on = live.has(id);
      if (on) {
        n.lastShown = now;
      } else if (now - n.lastShown > NODE_IDLE_MS && !this.editing) {
        // a big plan shows thousands of cards over its length: keep the DOM to the recent ones
        n.observer.disconnect();
        n.g.remove();
        this.nodes.delete(id);
        continue;
      }
      if (on !== n.shown) {
        n.shown = on;
        n.g.style.display = on ? '' : 'none';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private create(id: string): Node {
    const g = document.createElementNS(SVG_NS, 'g');
    const leader = document.createElementNS(SVG_NS, 'line');
    leader.setAttribute('stroke', DEFAULT_LEADER_COLOR);
    leader.setAttribute('stroke-width', '1.5');
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', DEFAULT_LEADER_COLOR);
    const card = document.createElementNS(SVG_NS, 'g');
    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('x', '0');
    fo.setAttribute('y', '0');
    fo.setAttribute('width', '1');
    fo.setAttribute('height', '1');
    fo.style.overflow = 'visible';
    fo.style.pointerEvents = this.interactive ? 'auto' : 'none';
    const body = document.createElementNS(XHTML_NS, 'div');
    if (!(body instanceof HTMLDivElement)) {
      throw new Error('AnimOverlay: XHTML div expected');
    }
    // max-content: lay the card out at its own width, not the foreignObject's
    // (1 px until measured) — else auto-width text wraps letter by letter
    body.style.cssText = 'display:inline-block;position:absolute;left:0;top:0;width:max-content;';
    fo.appendChild(body);
    card.appendChild(fo);
    g.append(leader, dot, card);
    this.svg.appendChild(g);
    const node: Node = {
      g,
      leader,
      dot,
      card,
      fo,
      body,
      size: [1, 1],
      place: [0, 0],
      shown: true,
      lastShown: performance.now(),
      leaderColor: DEFAULT_LEADER_COLOR,
      observer: new ResizeObserver(() => this.measure(node)),
    };
    node.observer.observe(body);
    this.wire(id, node);
    this.nodes.set(id, node);
    return node;
  }

  private measure(n: Node): void {
    const w = Math.max(1, n.body.offsetWidth || n.body.scrollWidth);
    const h = Math.max(1, n.body.offsetHeight || n.body.scrollHeight);
    if (w !== n.size[0] || h !== n.size[1]) {
      n.size = [w, h];
      n.fo.setAttribute('width', String(w));
      n.fo.setAttribute('height', String(h));
    }
  }

  /** Screen position, scale, leader and effect of one card. */
  private place(n: Node, r: ResolvedOverlay, f: OverlayFrame, w: number, h: number, vp: Float32Array): void {
    if (n.size[0] <= 1) {
      this.measure(n);
    }
    const s = (h / Math.max(100, r.component.designHeight)) * r.instance.scale;
    const cw = n.size[0] * s;
    const ch = n.size[1] * s;
    const a = r.instance.anchor;
    let x = 0;
    let y = 0;
    let anchorPx: [number, number] | null = null;
    if (a.kind === 'screen') {
      const pos = f.place ?? a.pos;
      n.place = [pos[0], pos[1]];
      const [fx, fy] = PIN_FRAC[a.pin];
      x = pos[0] * w - fx * cw;
      y = pos[1] * h - fy * ch;
    } else {
      const world = a.kind === 'object' ? this.scene.objectPoint(a.object) : a.pos;
      anchorPx = world ? projectToScreen(vp, w, h, world) : null;
      if (!anchorPx) {
        n.g.style.display = 'none';
        return;
      }
      const off = f.place ?? a.offset;
      n.place = [off[0], off[1]];
      [x, y] = this.scene.keepOnScreen()
        ? keepInView(anchorPx, off, cw, ch, w, h)
        : [anchorPx[0] + off[0] - cw / 2, anchorPx[1] + off[1] - ch / 2];
    }
    // effect from progress (deterministic — see the header)
    const e = smoothstep(f.progress);
    let opacity = 1;
    let fxScale = 1;
    let dx = 0;
    let dy = 0;
    if (f.fx.kind === 'fade') {
      opacity = e;
    } else if (f.fx.kind === 'pop') {
      opacity = e;
      fxScale = 0.8 + 0.2 * e;
    } else if (f.fx.kind === 'slide') {
      opacity = e;
      const d = (1 - e) * SLIDE_PX;
      dx = f.fx.from === 'left' ? -d : f.fx.from === 'right' ? d : 0;
      dy = f.fx.from === 'top' ? -d : f.fx.from === 'bottom' ? d : 0;
    }
    const sc = s * fxScale;
    const ox = x + dx + (cw - n.size[0] * sc) / 2;
    const oy = y + dy + (ch - n.size[1] * sc) / 2;
    n.card.setAttribute('transform', `translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${sc.toFixed(5)})`);
    n.g.setAttribute('opacity', opacity.toFixed(3));
    n.g.style.display = '';
    const showLeader = anchorPx !== null && a.kind !== 'screen' && a.leader && (n.place[0] !== 0 || n.place[1] !== 0);
    n.leader.style.display = showLeader ? '' : 'none';
    const tint = a.kind !== 'screen' ? (a.leaderColor ?? DEFAULT_LEADER_COLOR) : DEFAULT_LEADER_COLOR;
    if (tint !== n.leaderColor) {
      n.leaderColor = tint;
      n.leader.setAttribute('stroke', tint);
      n.dot.setAttribute('fill', tint);
    }
    n.dot.style.display = showLeader ? '' : 'none';
    if (showLeader && anchorPx) {
      n.leader.setAttribute('x1', anchorPx[0].toFixed(1));
      n.leader.setAttribute('y1', anchorPx[1].toFixed(1));
      n.leader.setAttribute('x2', (x + cw / 2).toFixed(1));
      n.leader.setAttribute('y2', (y + ch / 2).toFixed(1));
      n.dot.setAttribute('cx', anchorPx[0].toFixed(1));
      n.dot.setAttribute('cy', anchorPx[1].toFixed(1));
    }
    n.body.style.outline = this.interactive && this.selected === r.instance.id ? '2px dashed #38bdf8' : '';
  }

  /** Authoring gestures: drag moves the anchor, double-click edits text. */
  private wire(id: string, n: Node): void {
    let drag: { x: number; y: number; anchor: OverlayAnchor } | null = null;
    n.fo.addEventListener('pointerdown', (e) => {
      if (!this.interactive || this.editing) {
        return;
      }
      const r = this.scene.resolve(id);
      if (!r) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      this.onSelect?.(id);
      // start from what is drawn (a keyed placement), not the stored anchor
      const a0 = r.instance.anchor;
      const anchor: OverlayAnchor = a0.kind === 'screen' ? { ...a0, pos: n.place } : { ...a0, offset: n.place };
      drag = { x: e.clientX, y: e.clientY, anchor };
      n.fo.setPointerCapture(e.pointerId);
    });
    n.fo.addEventListener('pointermove', (e) => {
      if (!drag) {
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const a = drag.anchor;
      const w = this.host.clientWidth || 1;
      const h = this.host.clientHeight || 1;
      const next: OverlayAnchor =
        a.kind === 'screen'
          ? { ...a, pos: [Math.min(1, Math.max(0, a.pos[0] + dx / w)), Math.min(1, Math.max(0, a.pos[1] + dy / h))] }
          : { ...a, offset: [Math.round(a.offset[0] + dx), Math.round(a.offset[1] + dy)] };
      this.onMove?.(id, next);
    });
    const end = () => {
      drag = null;
    };
    n.fo.addEventListener('pointerup', end);
    n.fo.addEventListener('pointercancel', end);
    n.fo.addEventListener('dblclick', (e) => {
      const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-param]') : null;
      const param = target?.dataset.param;
      if (!this.interactive || !target || !param) {
        return;
      }
      e.stopPropagation();
      this.beginEdit(id, param, target);
    });
  }

  private beginEdit(id: string, param: string, el: HTMLElement): void {
    this.editing = true;
    el.contentEditable = 'plaintext-only';
    el.style.outline = '1px solid #38bdf8';
    el.focus();
    const done = (commit: boolean) => {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      el.contentEditable = 'false';
      el.style.outline = '';
      this.editing = false;
      if (commit) {
        this.onEditText?.(id, param, el.innerText.replace(/\n$/, ''));
      }
    };
    const onBlur = () => done(true);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation(); // typing must not trigger viewer hotkeys
      if (e.key === 'Escape') {
        done(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      }
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
  }
}

/** World anchor point of an object: its pivot moved by the current pose. */
export function objectAnchorPoint(pivot: V3, pose: Float32Array | null): V3 {
  return pose ? m4TransformPoint(pose, pivot) : pivot;
}
