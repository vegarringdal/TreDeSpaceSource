// The viewport's 2D layers drawn onto a capture canvas — screenshots and
// animation video frames: every SVG overlay (animation cards, callouts,
// measurement marks) rasterized at the capture size, then the scene labels,
// which are HTML and drawn by hand.

import { projectToScreen } from '../../lib/math/project';
import { rasterizeSvgOverlay } from '../../lib/overlay/svgCapture';
import { labelsState, type SceneLabel } from './labels.state';
import { getRenderer } from './viewer.actions';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Rich-text line → [text, bold] segments (matches the label overlay's **bold**). */
function boldSegments(line: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let bold = false;
  for (const part of line.split('**')) {
    if (part) {
      out.push([part, bold]);
    }
    bold = !bold;
  }
  return out;
}

/** Draw the scene labels (leader lines + boxes) onto the screenshot canvas —
 *  they are HTML, not SVG, so the SVG-overlay compositor misses them. Muted
 *  labels (each, or all) are left out, as on screen. */
function drawLabels(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  const r = getRenderer();
  if (!r?.canvasEl) {
    return;
  }
  const s = labelsState.get();
  const shown = s.muted ? [] : s.items.filter((l) => !l.muted);
  if (shown.length === 0) {
    return;
  }
  const w = r.canvasEl.clientWidth;
  const h = r.canvasEl.clientHeight;
  const at = (l: SceneLabel) => projectToScreen(r.viewProjMatrix, w, h, l.anchor);
  // leader lines + anchor dots first (labels draw on top, like the DOM order)
  for (const l of shown) {
    const a = at(l);
    if (!a || (l.offset[0] === 0 && l.offset[1] === 0)) {
      continue;
    }
    ctx.strokeStyle = l.leaderColor ?? s.leaderColor;
    ctx.fillStyle = l.leaderColor ?? s.leaderColor;
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath();
    ctx.moveTo(a[0] * sx, a[1] * sy);
    ctx.lineTo((a[0] + l.offset[0]) * sx, (a[1] + l.offset[1]) * sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a[0] * sx, a[1] * sy, 2.5 * sx, 0, 2 * Math.PI);
    ctx.fill();
  }
  const fontPx = 12 * sx;
  const lineH = 15 * sx;
  const padX = 6 * sx;
  const padY = 2 * sx;
  for (const l of shown) {
    const a = at(l);
    if (!a) {
      continue;
    }
    const lines = (s.richText ? l.text.split('\n') : [l.text]).map(boldSegments);
    let maxW = 0;
    for (const segs of lines) {
      let lw = 0;
      for (const [text, bold] of segs) {
        ctx.font = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;
        lw += ctx.measureText(text).width;
      }
      maxW = Math.max(maxW, lw);
    }
    const bw = maxW + padX * 2;
    const bh = lines.length * lineH + padY * 2;
    const x0 = (a[0] + l.offset[0]) * sx - bw / 2;
    const y0 = (a[1] + l.offset[1]) * sy - bh / 2;
    ctx.globalAlpha = l.opacity;
    ctx.fillStyle = l.bg;
    ctx.fillRect(x0, y0, bw, bh);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1 * sx;
    ctx.strokeRect(x0, y0, bw, bh);
    ctx.fillStyle = l.textColor;
    ctx.textBaseline = 'middle';
    lines.forEach((segs, i) => {
      let x = x0 + padX;
      const y = y0 + padY + lineH * (i + 0.5);
      for (const [text, bold] of segs) {
        ctx.font = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;
        ctx.fillText(text, x, y);
        x += ctx.measureText(text).width;
      }
    });
    ctx.globalAlpha = 1;
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Draw the viewport's SVG overlays and scene labels onto `ctx`, a capture
 *  of `shotW × shotH` device pixels of the whole viewport. An overlay the
 *  browser refuses to rasterize is skipped — the base image still ships.
 *  `content` leaves out the editing chrome (clip handles, the measuring
 *  aim: SVGs marked data-ui-chrome) — video frames; screenshots keep all. */
export async function drawViewportOverlays(
  ctx: CanvasRenderingContext2D,
  shotW: number,
  shotH: number,
  opts: { content?: boolean } = {},
): Promise<void> {
  const r = getRenderer();
  const host = r?.canvasEl?.parentElement;
  if (!r?.canvasEl || !host) {
    return;
  }
  for (const svg of host.querySelectorAll(':scope > svg')) {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !(svg instanceof SVGSVGElement)) {
      continue;
    }
    if (opts.content && svg.dataset.uiChrome) {
      continue;
    }
    const layer = await rasterizeSvgOverlay(svg, rect, shotW, shotH);
    if (layer) {
      ctx.drawImage(layer, 0, 0);
    }
  }
  drawLabels(ctx, shotW / Math.max(1, r.canvasEl.clientWidth), shotH / Math.max(1, r.canvasEl.clientHeight));
}
