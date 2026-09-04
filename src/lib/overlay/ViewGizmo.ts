export type GizmoFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type GizmoPickKind = 'face' | 'edge' | 'corner';

export interface GizmoPick {
  kind: GizmoPickKind;
  /** e.g. "front", "front+right", "front+top+right" */
  id: string;
  /** Unit view direction (three.js axes, y up, +z front). */
  direction: [number, number, number];
}

export interface ViewGizmoOptions {
  /** Face texts — override any subset: `{ front: 'F', top: 'UP' }`. */
  labels?: Partial<Record<GizmoFace, string>>;
  /** Cube edge in px. */
  size?: number;
  /** Start offset from the container's bottom-RIGHT corner, so the gizmo stays
   *  pinned to the corner when the viewport/side panels resize. */
  position?: { right: number; bottom: number };
  /** Clicking a face, edge bevel or corner — e.g. snap the camera there. */
  onPick?: (pick: GizmoPick) => void;
  /** Pointer entered/left a zone (null = left). Drives the GPU cube's hover. */
  onHover?: (pick: GizmoPick | null) => void;
  /** false = invisible hit-layer only: the cube is DRAWN by the renderer
   *  (see viewCubeGpu.ts); the DOM plates keep hit-testing/hover/drag. */
  visual?: boolean;
}

/** Face labels are capped to this many chars so all faces share ONE font size. */
const MAX_LABEL_CHARS = 5;
const clampLabel = (s: string): string => String(s).slice(0, MAX_LABEL_CHARS);

const defaultLabels: Record<GizmoFace, string> = {
  front: 'FRONT',
  back: 'BACK',
  left: 'LEFT',
  right: 'RIGHT',
  top: 'TOP',
  bottom: 'BOT',
};

/** World direction each face looks along (Z up, CAD-style: front is −Y). */
export const gizmoFaceDirections: Record<GizmoFace, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
};

// Keeps face text upright (a generic normal→rotation gives arbitrary roll).
// Z-up: front (−Y) faces the default viewer, top (+Z) points up.
const facePlacement: Record<GizmoFace, string> = {
  front: 'rotateX(-90deg)',
  back: 'rotateX(-90deg) rotateY(180deg)',
  right: 'rotateX(-90deg) rotateY(90deg)',
  left: 'rotateX(-90deg) rotateY(-90deg)',
  top: 'rotateZ(0deg)',
  bottom: 'rotateX(180deg)',
};

const COL = {
  base: '#333a46',
  baseFace: '#2f3641',
  border: '#4d5665',
  hover: '#4a6d9c',
  text: '#c9cfd8',
};

/** The gizmo always keeps this many px between itself and the viewport edges. */
const MARGIN = 25;

const deg = (rad: number) => (rad * 180) / Math.PI;

/** rotateY/rotateX pair that points a plate's local +z along unit normal n. */
function orient(n: [number, number, number]): string {
  const ax = deg(Math.asin(n[1]));
  const ay = deg(Math.atan2(n[0], n[2]));
  return `rotateY(${ay}deg) rotateX(${ax}deg)`;
}

/**
 * A beveled orientation cube for a 3D viewport — framework-free, so it drops
 * into the plain-DOM viewport panel as easily as into React. Faces, chamfered
 * edges and corners all highlight on hover and report clicks via onPick.
 * Feed it the camera quaternion every frame; grab the handle to move it.
 */
export class ViewGizmo {
  private root: HTMLDivElement;
  private cube: HTMLDivElement;
  private faces = new Map<GizmoFace, HTMLDivElement>();
  private pos: { right: number; bottom: number };
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private visual = true;
  private stage!: HTMLDivElement;

  constructor(container: HTMLElement, opts: ViewGizmoOptions = {}) {
    this.container = container;
    const S = opts.size ?? 72;
    const c = S * 0.16; // chamfer width
    this.pos = { ...(opts.position ?? { right: 12, bottom: 12 }) };

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      right: `${this.pos.right}px`,
      bottom: `${this.pos.bottom}px`,
      zIndex: '5',
      display: 'flex',
      flexDirection: 'column',
      // Handle sits top-right, clear of the cube, so it is always grabbable.
      alignItems: 'flex-end',
      gap: '8px',
      userSelect: 'none',
      touchAction: 'none',
      paddingRight: '0px',
    } satisfies Partial<CSSStyleDeclaration>);

    // -- drag handle ---------------------------------------------------------
    const handle = document.createElement('div');
    handle.title = 'Move gizmo';
    Object.assign(handle.style, {
      width: '26px',
      height: '8px',
      cursor: 'grab',
      // Poke out past the cube's top-right corner so a rotated cube never covers it.
      marginRight: '-12px',
      background:
        'radial-gradient(circle at 4px 2px, #7c8595 1px, transparent 1.2px), radial-gradient(circle at 4px 6px, #7c8595 1px, transparent 1.2px)',
      backgroundSize: '8px 8px',
      opacity: '0.55',
    } satisfies Partial<CSSStyleDeclaration>);
    handle.addEventListener('pointerenter', () => {
      handle.style.opacity = '1';
    });
    handle.addEventListener('pointerleave', () => {
      handle.style.opacity = '0.55';
    });
    handle.addEventListener('pointerdown', this.startDrag);

    // -- cube ----------------------------------------------------------------
    const stage = document.createElement('div');
    Object.assign(stage.style, {
      width: `${S}px`,
      height: `${S}px`,
      /* No perspective: plates at different depths project consistently, like the CAD reference. */
    } satisfies Partial<CSSStyleDeclaration>);

    this.cube = document.createElement('div');
    Object.assign(this.cube.style, {
      width: '100%',
      height: '100%',
      position: 'relative',
      transformStyle: 'preserve-3d',
    } satisfies Partial<CSSStyleDeclaration>);

    const visual = opts.visual ?? true;
    const plate = (w: number, h: number, transform: string, pick: GizmoPick, base: string): HTMLDivElement => {
      const el = document.createElement('div');
      el.dataset.gizmoPick = pick.id;
      Object.assign(el.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${w}px`,
        height: `${h}px`,
        margin: `${-h / 2}px 0 0 ${-w / 2}px`,
        transform,
        background: visual ? base : 'transparent',
        backfaceVisibility: 'hidden',
        cursor: opts.onPick ? 'pointer' : 'default',
        boxShadow: visual ? `inset 0 0 0 1px ${COL.border}` : 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      el.addEventListener('pointerenter', () => {
        if (visual) {
          el.style.background = COL.hover;
        }
        opts.onHover?.(pick);
      });
      el.addEventListener('pointerleave', () => {
        if (visual) {
          el.style.background = base;
        }
        opts.onHover?.(null);
      });
      el.addEventListener('click', () => opts.onPick?.(pick));
      this.cube.appendChild(el);
      return el;
    };
    this.visual = visual;

    // -- 6 faces (flat square between the chamfers) ---------------------------
    const faceSize = S - 2 * c;
    for (const face of Object.keys(facePlacement) as GizmoFace[]) {
      const el = plate(
        faceSize,
        faceSize,
        `${facePlacement[face]} translateZ(${S / 2}px)`,
        { kind: 'face', id: face, direction: gizmoFaceDirections[face] },
        COL.baseFace,
      );
      const text = clampLabel(opts.labels?.[face] ?? defaultLabels[face]);
      if (visual) {
        el.textContent = text;
        Object.assign(el.style, {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: COL.text,
          font: `700 ${this.faceFont(faceSize)}px/1 ui-sans-serif, system-ui, sans-serif`,
          letterSpacing: '0.02em',
        } satisfies Partial<CSSStyleDeclaration>);
      }
      this.faces.set(face, el);
    }

    // -- 12 edge bevels --------------------------------------------------------
    const bevelW = c * Math.SQRT2;
    const edgeT = (S - c) / Math.SQRT2;
    const axes: Array<[GizmoFace, GizmoFace]> = [
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
    for (const [a, b] of axes) {
      const da = gizmoFaceDirections[a];
      const db = gizmoFaceDirections[b];
      const dir: [number, number, number] = [
        (da[0] + db[0]) / Math.SQRT2,
        (da[1] + db[1]) / Math.SQRT2,
        (da[2] + db[2]) / Math.SQRT2,
      ];
      // Which local plate axis orient() aligns with the edge line depends on
      // the edge family (Z-up): only left/right+top/bottom edges keep the
      // long side on local y; the rest (side-side and front/back+top/bottom)
      // run along local x.
      const tall = dir[1] === 0 && dir[2] !== 0;
      plate(
        tall ? bevelW : faceSize,
        tall ? faceSize : bevelW,
        `${orient(dir)} translateZ(${edgeT}px)`,
        { kind: 'edge', id: `${a}+${b}`, direction: dir },
        COL.base,
      );
    }

    // -- 8 corner triangles ----------------------------------------------------
    const cornerT = (1.5 * S - 2 * c) / Math.sqrt(3);
    const triSize = bevelW * 1.14;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const k = 1 / Math.sqrt(3);
          const dir: [number, number, number] = [sx * k, sy * k, sz * k];
          const names = [sy < 0 ? 'front' : 'back', sz > 0 ? 'top' : 'bottom', sx > 0 ? 'right' : 'left'];
          // Authored space = world with y flipped (see update()).
          const n = { x: sx * k, y: -sy * k, z: sz * k };
          // rotateY/rotateX put the plate normal at (sinφcosθ, -sinθ, cosφcosθ),
          // so θ carries a minus sign relative to n.y.
          const theta = -Math.asin(n.y);
          const phi = Math.atan2(n.x, n.z);
          // Roll the plate so the triangle's vertex points at the top/bottom
          // face: v = world up(down) projected onto the plate plane.
          const tn = sz * n.z; // t·n with t = (0,0,sz)
          const v = { x: -tn * n.x, y: -tn * n.y, z: sz - tn * n.z };
          const vl = Math.hypot(v.x, v.y, v.z) || 1;
          const X = { x: Math.cos(phi), y: 0, z: -Math.sin(phi) };
          const Y = { x: Math.sin(phi) * Math.sin(theta), y: Math.cos(theta), z: Math.cos(phi) * Math.sin(theta) };
          const dotX = (v.x * X.x + v.y * X.y + v.z * X.z) / vl;
          const dotY = (v.x * Y.x + v.y * Y.y + v.z * Y.z) / vl;
          const psi = Math.atan2(dotX, -dotY);
          const el = plate(
            triSize,
            triSize,
            `rotateY(${deg(phi)}deg) rotateX(${deg(theta)}deg) rotateZ(${deg(psi)}deg) translateZ(${cornerT}px)`,
            { kind: 'corner', id: names.join('+'), direction: dir },
            COL.base,
          );
          // Equilateral-ish, vertex up — the roll above points it correctly.
          el.style.clipPath = 'polygon(50% 0%, 6% 75%, 94% 75%)'; // centroid at plate centre
        }
      }
    }

    stage.appendChild(this.cube);
    this.root.append(handle, stage);
    container.appendChild(this.root);
    this.stage = stage;

    // If the viewport shrinks (panel resize, dock rearrange), pull the gizmo
    // back inside rather than letting it get clipped away.
    this.resizeObserver = new ResizeObserver(() => this.clamp());
    this.resizeObserver.observe(container);
  }

  /** Keep the gizmo fully inside the container. */
  private clamp() {
    const bounds = this.container.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return; // hidden tab — leave as-is
    }
    const rect = this.root.getBoundingClientRect();
    this.pos.right = Math.min(Math.max(MARGIN, this.pos.right), Math.max(MARGIN, bounds.width - rect.width - MARGIN));
    this.pos.bottom = Math.min(
      Math.max(MARGIN, this.pos.bottom),
      Math.max(MARGIN, bounds.height - rect.height - MARGIN),
    );
    this.root.style.right = `${this.pos.right}px`;
    this.root.style.bottom = `${this.pos.bottom}px`;
  }

  /** Sync to the camera each frame (pass `camera.quaternion`). */
  private lastTransform = '';

  update(q: { x: number; y: number; z: number; w: number }) {
    const { x, y, z, w } = q;
    // View rotation = R(q)ᵀ, expressed in CSS space (y down) by conjugating
    // with diag(1,-1,1) — negating the y row AND column keeps it a pure
    // rotation, so face text is never mirrored.
    const m00 = 1 - 2 * (y * y + z * z);
    const m01 = 2 * (x * y - z * w);
    const m02 = 2 * (x * z + y * w);
    const m10 = 2 * (x * y + z * w);
    const m11 = 1 - 2 * (x * x + z * z);
    const m12 = 2 * (y * z - x * w);
    const m20 = 2 * (x * z - y * w);
    const m21 = 2 * (y * z + x * w);
    const m22 = 1 - 2 * (x * x + y * y);
    const transform = `matrix3d(${m00},${-m01},${m02},0,${-m10},${m11},${-m12},0,${m20},${-m21},${m22},0,0,0,0,1)`;
    // written only on change: the update runs every tick, and an identical
    // inline style must not invalidate the cube's layer while the camera rests
    if (transform !== this.lastTransform) {
      this.lastTransform = transform;
      this.cube.style.transform = transform;
    }
  }

  /** Uniform face font: always sized to the MAX_LABEL_CHARS cap, so a short
   *  label (TOP) and a full-length one (RIGHT) render at the SAME height. */
  private faceFont(faceSize: number): number {
    return Math.max(6, (faceSize * 0.78) / MAX_LABEL_CHARS);
  }

  /** The cube stage box in CSS px relative to the container — the renderer's
   *  mini-viewport tracks this (updated per frame, so dragging follows). */
  getRect(): { x: number; y: number; size: number } {
    const b = this.container.getBoundingClientRect();
    const s = this.stage.getBoundingClientRect();
    return { x: s.left - b.left, y: s.top - b.top, size: s.width };
  }

  /** Change face texts at runtime. */
  setLabels(labels: Partial<Record<GizmoFace, string>>) {
    if (!this.visual) {
      return; // GPU cube labels go through renderer.setViewCubeLabels
    }
    for (const [face, text] of Object.entries(labels) as Array<[GizmoFace, string]>) {
      const el = this.faces.get(face);
      if (el && text != null) {
        el.textContent = clampLabel(text);
        el.style.fontSize = `${this.faceFont(el.clientWidth || 40)}px`;
      }
    }
  }

  private startDrag = (e: PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = 'grabbing';
    const start = { x: e.clientX, y: e.clientY, ...this.pos };

    const onMove = (ev: PointerEvent) => {
      const bounds = this.container.getBoundingClientRect();
      const rect = this.root.getBoundingClientRect();
      // dragging right (clientX up) reduces the offset from the right edge
      this.pos.right = Math.min(
        Math.max(MARGIN, start.right - (ev.clientX - start.x)),
        Math.max(MARGIN, bounds.width - rect.width - MARGIN),
      );
      this.pos.bottom = Math.min(
        Math.max(MARGIN, start.bottom - (ev.clientY - start.y)),
        Math.max(MARGIN, bounds.height - rect.height - MARGIN),
      );
      this.root.style.right = `${this.pos.right}px`;
      this.root.style.bottom = `${this.pos.bottom}px`;
    };
    const onUp = () => {
      handle.style.cursor = 'grab';
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  dispose() {
    this.resizeObserver.disconnect();
    this.root.remove();
  }
}
