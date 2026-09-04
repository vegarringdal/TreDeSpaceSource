// VRAM-budget debug overlay: wireframe AABB per tracked zone, colored by
// residency state, so the manager's decisions are visible — especially the
// UNLOADED zones, whose geometry is otherwise simply absent from the frame.
// 2D canvas on top of the viewport; boxes are the same visible-item bounds
// the priority function measures the camera against.
import { residency } from '../../state/viewer/residency';
import { viewerState } from '../../state/viewer/viewer.state';
import { vramBudgetMb } from '../../state/viewer/vramBudget';
import { projectToScreen } from '../math/project';
import type { Renderer } from '../render/renderer';

const VARIANT_COLORS = {
  full: '#2f9e44', // resident at full detail
  mixed: '#9c36b5', // near items full, remainder coarse (tier 2.5)
  coarse: '#f08c00', // coarse variant resident
  unloaded: '#e03131', // nothing on the GPU
} as const;
const IN_FLIGHT_COLOR = '#4dabf7';

// AABB corner indices per edge (corner bit k selects min/max on axis k)
const EDGES: readonly [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export class ResidencyBoxOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: Renderer;

  constructor(host: HTMLElement, renderer: Renderer) {
    this.renderer = renderer;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;';
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('ResidencyBoxOverlay: no 2d context');
    }
    this.ctx = ctx;
  }

  /** Per-frame: draw every tracked zone's box (no-op unless enabled). */
  update(): void {
    const s = viewerState.get();
    const show = s.vramDebugBoxes && vramBudgetMb(s) > 0;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.clearRect(0, 0, w, h);
    if (!show || w === 0 || h === 0) {
      return;
    }
    const vp = this.renderer.viewProjMatrix;
    for (const rec of residency.debugRecords()) {
      const b = rec.bounds;
      const corners: ([number, number] | null)[] = [];
      for (let c = 0; c < 8; c++) {
        corners.push(projectToScreen(vp, w, h, [b[c & 1 ? 3 : 0], b[c & 2 ? 4 : 1], b[c & 4 ? 5 : 2]]));
      }
      this.ctx.strokeStyle = rec.inFlight ? IN_FLIGHT_COLOR : VARIANT_COLORS[rec.variant];
      this.ctx.lineWidth = rec.inFlight ? 2.5 : 1.25;
      this.ctx.globalAlpha = 0.35 + 0.65 * rec.visibleFrac;
      this.ctx.beginPath();
      for (const [a, bIdx] of EDGES) {
        const p = corners[a];
        const q = corners[bIdx];
        if (!p || !q) {
          continue;
        }
        this.ctx.moveTo(p[0], p[1]);
        this.ctx.lineTo(q[0], q[1]);
      }
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
