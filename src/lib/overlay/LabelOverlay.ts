// Scene-label overlay: world-anchored draggable text labels on top of the
// viewport (same projection pattern as MeasureOverlay). Labels are DOM nodes
// (selectable/draggable); leader lines live in one SVG underneath them.
import { labelsActions } from '../../state/viewer/labels.actions';
import { labelsState, type SceneLabel } from '../../state/viewer/labels.state';
import { projectToScreen } from '../math/project';
import type { V3 } from '../math/quat';
import type { Renderer } from '../render/renderer';
import { escapeHtml, richTextHtml } from '../richText';

/** rich mode: **bold** spans + newlines; simple mode: plain single line */
function labelHtml(l: SceneLabel, rich: boolean): string {
  return rich ? richTextHtml(l.text) : escapeHtml(l.text);
}

export class LabelOverlay {
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private nodes = new Map<number, HTMLDivElement>();
  private host: HTMLElement;
  private renderer: Renderer;
  private builtVersion = -1;

  constructor(host: HTMLElement, renderer: Renderer) {
    this.host = host;
    this.renderer = renderer;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
    this.root.appendChild(this.svg);
    host.appendChild(this.root);
  }

  dispose() {
    this.root.remove();
  }

  private toScreen(p: V3): [number, number] | null {
    const r = this.host.getBoundingClientRect();
    return projectToScreen(this.renderer.viewProjMatrix, r.width, r.height, p);
  }

  /** Rebuild label nodes when the set changed; reposition every frame. */
  update() {
    const s = labelsState.get();
    // presentation mute: hide the whole overlay, keep the items untouched
    this.root.style.display = s.muted ? 'none' : '';
    if (s.muted) {
      return;
    }
    if (s.version !== this.builtVersion) {
      this.builtVersion = s.version;
      this.rebuild(s.items, s.richText, s.leaderColor);
    }
    let lines = '';
    for (const l of s.items) {
      const node = this.nodes.get(l.id);
      if (!node) {
        continue;
      }
      if (l.muted) {
        node.style.display = 'none';
        continue;
      }
      const at = this.toScreen(l.anchor);
      if (!at) {
        node.style.display = 'none';
        continue;
      }
      node.style.display = '';
      const x = at[0] + l.offset[0];
      const y = at[1] + l.offset[1];
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      if (l.offset[0] !== 0 || l.offset[1] !== 0) {
        lines += `<line x1="${at[0]}" y1="${at[1]}" x2="${x}" y2="${y}" stroke="${s.leaderColor}" stroke-width="1.5"/><circle cx="${at[0]}" cy="${at[1]}" r="2.5" fill="${s.leaderColor}"/>`;
      }
    }
    if (this.svg.innerHTML !== lines) {
      this.svg.innerHTML = lines;
    }
  }

  private rebuild(items: SceneLabel[], rich: boolean, leaderColor: string) {
    const seen = new Set<number>();
    for (const l of items) {
      seen.add(l.id);
      let node = this.nodes.get(l.id);
      if (!node) {
        node = document.createElement('div');
        node.style.cssText =
          'position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:grab;' +
          // touch-action:none so a touch-drag moves the label instead of the
          // browser hijacking it to pan/zoom the page (no pointermove otherwise)
          'touch-action:none;padding:2px 6px;font:12px sans-serif;white-space:pre;user-select:none;max-width:280px;';
        this.wireEvents(node, l.id);
        this.root.appendChild(node);
        this.nodes.set(l.id, node);
      }
      node.innerHTML = labelHtml(l, rich);
      node.style.background = l.bg;
      node.style.color = l.textColor;
      node.style.opacity = String(l.opacity);
      // unselected border matches the leader-line colour (selection = black dash)
      node.style.border = l.selected ? '1.5px dashed #000000' : `1px solid ${leaderColor}`;
      node.style.whiteSpace = rich ? 'normal' : 'pre';
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
  }

  private wireEvents(node: HTMLDivElement, id: number) {
    node.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.ctrlKey) {
        labelsActions.toggleSelect(id);
        return;
      }
      const l = labelsState.get().items.find((x) => x.id === id);
      if (!l) {
        return;
      }
      const pre: [number, number] = [l.offset[0], l.offset[1]];
      const sx = e.clientX;
      const sy = e.clientY;
      node.setPointerCapture(e.pointerId);
      node.style.cursor = 'grabbing';
      const move = (ev: PointerEvent) => {
        labelsActions.dragMove(id, [pre[0] + ev.clientX - sx, pre[1] + ev.clientY - sy]);
      };
      const up = () => {
        node.style.cursor = 'grab';
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        labelsActions.dragEnd(id, pre);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  }
}
