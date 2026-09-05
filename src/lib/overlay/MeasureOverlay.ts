// Measurement overlay: draws all measurements (completed + the in-progress
// preview) as SVG on top of the viewport, ported from the native egui-painter
// overlay (cad-app/src/ui/overlays.rs `paint_measurements`). Projection uses the
// renderer's live view-projection matrix, so it is correct for both the
// perspective and orthographic cameras.
import {
  circle as circleOf,
  displayName,
  faceGap,
  lockProject,
  type MeasureHit,
  type Measurement,
  type MeasurePoint,
  type MeasureToolKind,
  measurementsState,
  perimeter,
  perpProject,
  segmentLengths,
  slope,
  span,
  tip,
  valueLabel,
} from '../../state/viewer/measurements.state';
import { projectToScreen } from '../math/project';
import type { V3 } from '../math/quat';
import type { Renderer } from '../render/renderer';

// Hover snap glyphs keep this fixed colour; measurement geometry follows the
// user-set colour (measurementsState.lineColor).
const LINE_COL = '#ffd25a';
const PT_COL = '#ffffff';
const PERP_COL = '#aa6e3c';
// staircase LINES: saturated (they sit on the model, over a white halo)
const AXIS_COLS = ['#e03131', '#237032', '#1c7ed6'];
// staircase label TEXT: bright variants — readable on the dark label box
const AXIS_LABEL_COLS = ['#ff8787', '#8ce99a', '#74c0fc'];

/** '#rrggbb' → rgba() with the given alpha (the area fill tint). */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

type Pt = [number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normV = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const BOLD_SPAN = /(\*\*[^*]+\*\*)/;
const isBold = (seg: string) => /^\*\*[^*]+\*\*$/.test(seg);

/** One label line as SVG: `**bold**` spans → nested bold tspans, the rest
 *  escaped — the same markup the scene labels take. */
function richTspans(line: string): string {
  return line
    .split(BOLD_SPAN)
    .filter((seg) => seg.length > 0)
    .map((seg) => (isBold(seg) ? `<tspan font-weight="bold">${esc(seg.slice(2, -2))}</tspan>` : esc(seg)))
    .join('');
}

/** Rendered width at 12px, roughly — bold runs a little wider, markers don't count. */
function lineWidthPx(line: string): number {
  let w = 0;
  for (const seg of line.split(BOLD_SPAN)) {
    w += isBold(seg) ? (seg.length - 4) * 7.3 : seg.length * 6.6;
  }
  return w;
}
const unit = (v: [number, number]): [number, number] => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

export class MeasureOverlay {
  private svg: SVGSVGElement;
  private host: HTMLElement;
  private renderer: Renderer;
  private lastHtml = '';
  // per-frame from measurementsState.lineColor (black by default)
  private col = '#000000';
  private fill = withAlpha('#000000', 0.14);

  constructor(host: HTMLElement, renderer: Renderer) {
    this.host = host;
    this.renderer = renderer;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:5';
    host.appendChild(this.svg);
  }

  dispose() {
    this.svg.remove();
  }

  private toScreen(p: V3): Pt | null {
    const r = this.host.getBoundingClientRect();
    return projectToScreen(this.renderer.viewProjMatrix, r.width, r.height, p);
  }

  /** Re-render the overlay (called once per frame from the viewport tick). */
  update() {
    const s = measurementsState.get();
    if (s.lineColor !== this.col) {
      this.col = s.lineColor;
      this.fill = withAlpha(s.lineColor, 0.14);
    }
    let out = '';

    // Completed measurements — hidden entirely while globally muted.
    if (!s.muted) {
      for (const m of s.items) {
        if (m.visible) {
          out += this.drawMeasurement(m, true, m.showLabel ? displayName(m) : null, m.showLabel);
        }
      }
    }

    // In-progress preview: placed points + a rubber-band to the live hover.
    if (s.activeKind && s.inProgress.length > 0) {
      const pts: MeasurePoint[] = [...s.inProgress];
      if (s.hover) {
        const prev = pts[pts.length - 1];
        let pos = prev && s.perp ? perpProject(prev, s.hover.point) : s.hover.point;
        if (s.lock !== 'none') {
          pos = lockProject(s.lock, pts, pos);
        }
        pts.push(
          pos !== s.hover.point
            ? { pos, normal: s.hover.normal, clicked: s.hover.point }
            : { pos, normal: s.hover.normal },
        );
      }
      const preview: Measurement = {
        id: 0,
        kind: s.activeKind,
        points: pts,
        label: '',
        visible: true,
        showLabel: true,
        showPerp: true,
        axisLegs: [false, false, false],
        axisLabels: [false, false, false],
        legsInLabel: false,
        slopeInLabel: false,
      };
      out += this.drawMeasurement(preview, false, null, true);
    }

    // Hover snap glyph (face disc + normal arrow / edge bar / corner X).
    if (s.activeKind && s.hover) {
      out += this.snapGlyph(s.hover);
    }

    // queued labels last: on top of the geometry, pushed apart if overlapping
    out += this.flushLabels();

    if (out !== this.lastHtml) {
      this.svg.innerHTML = out;
      this.lastHtml = out;
    }
  }

  // Labels are QUEUED during drawing and emitted last (after a de-overlap
  // pass), so they never hide under lines and never sit on top of each other.
  private pending: {
    x: number;
    y: number;
    w: number;
    h: number;
    lines: string[];
    color: string;
    /** Per-line fill override (index-aligned; undefined = `color`). */
    lineColors?: (string | undefined)[];
    /** Solid background (main labels); leg labels stay translucent. */
    opaque?: boolean;
  }[] = [];

  private label(p: Pt, text: string, lineColors?: (string | undefined)[]): string {
    return this.labelC(p, text, PT_COL, lineColors, true);
  }

  private labelC(p: Pt, text: string, color: string, lineColors?: (string | undefined)[], opaque = false): string {
    const lines = text.split('\n');
    const w = Math.max(...lines.map(lineWidthPx)) + 8;
    const h = lines.length * 14 + 4;
    this.pending.push({ x: p[0] + 8, y: p[1] - h / 2, w, h, lines, color, lineColors, opaque });
    return '';
  }

  /** Fill overrides colouring the LAST three lines of `text` as X/Y/Z. */
  private axisLineColors(text: string): (string | undefined)[] {
    const n = text.split('\n').length;
    const colors = new Array<string | undefined>(n);
    for (let i = 0; i < 3 && n - 3 + i >= 0; i++) {
      colors[n - 3 + i] = AXIS_LABEL_COLS[i];
    }
    return colors;
  }

  /** Emit every queued label, nudging overlapping ones down until they clear
   *  each other. O(n²) on the handful of visible labels — negligible. */
  private flushLabels(): string {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    let out = '';
    // stable top-to-bottom order so a label always yields to the ones above it
    for (const l of this.pending.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const pad = 2;
      for (let guard = 0; guard < 50; guard++) {
        const hit = placed.find(
          (r) => l.x < r.x + r.w + pad && r.x < l.x + l.w + pad && l.y < r.y + r.h + pad && r.y < l.y + l.h + pad,
        );
        if (!hit) {
          break;
        }
        l.y = hit.y + hit.h + pad; // slide below the label it collides with
      }
      placed.push(l);
      const tspans = l.lines
        .map((t, i) => {
          const fill = l.lineColors?.[i] ? ` fill="${l.lineColors[i]}"` : '';
          return `<tspan x="${l.x + 4}" dy="${i === 0 ? 13 : 14}"${fill}>${richTspans(t)}</tspan>`;
        })
        .join('');
      out +=
        `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="3" fill="${l.opaque ? 'rgb(20,22,26)' : 'rgba(20,22,26,0.82)'}"/>` +
        `<text font-family="system-ui,sans-serif" font-size="12" fill="${l.color}" y="${l.y}">${tspans}</text>`;
    }
    this.pending = [];
    return out;
  }

  private markers(scr: (Pt | null)[]): string {
    let out = '';
    for (const s of scr) {
      if (!s) {
        continue;
      }
      out += `<circle cx="${s[0]}" cy="${s[1]}" r="4.5" fill="none" stroke="${this.col}" stroke-width="1"/>`;
      out += `<circle cx="${s[0]}" cy="${s[1]}" r="3" fill="${PT_COL}"/>`;
    }
    return out;
  }

  /** "X: … / Y: … / Z: …" lines appended to the main label when enabled. */
  private legsSuffix(m: Measurement, prec: number): string {
    if (!m.legsInLabel) {
      return '';
    }
    const sp = span(m);
    return ['X', 'Y', 'Z'].map((n, ax) => `\n${n}: ${formatSeg(Math.abs(sp[ax]), prec)}`).join('');
  }

  /** "∠ …° (…%)" slope line appended to a line's label when enabled (the %
   *  fall is omitted for a vertical line, where it is undefined). */
  private slopeSuffix(m: Measurement, prec: number): string {
    if (!m.slopeInLabel) {
      return '';
    }
    const s = slope(m);
    const deg = s.deg.toFixed(Math.min(prec, 2));
    return s.pct === null ? `\n∠ ${deg}°` : `\n∠ ${deg}° (${s.pct.toFixed(1)}%)`;
  }

  private drawMeasurement(m: Measurement, finished: boolean, name: string | null, labels: boolean): string {
    const titled = (v: string) => (name ? `${name}\n${v}` : v);
    const scr = m.points.map((p) => this.toScreen(p.pos));
    const prec = measurementsState.get().precision;
    let out = '';
    if (m.kind === 'point') {
      // coordinate annotation: just the marker + an XYZ label (axis-coloured)
      if (labels && scr[0]) {
        const txt = titled(valueLabel(m, prec));
        out += this.label(scr[0], txt, this.axisLineColors(txt));
      }
    } else if (m.kind === 'angle') {
      out += this.angle(m, scr, labels, titled, prec);
    } else if (m.kind === 'line' || m.kind === 'path') {
      out += this.polyline(scr, m.kind, labels, titled, m, prec);
    } else if (m.kind === 'area') {
      out += this.polygon(scr, finished, labels, titled, m, prec);
    } else if (m.kind === 'diameter') {
      out += this.diameter(m, scr, labels, titled, prec);
    } else if (m.kind === 'face') {
      out += this.faceDist(m, scr, labels, titled, prec);
    }
    if (m.showPerp) {
      out += this.perpHelper(m);
    }
    if (m.kind === 'line' || m.kind === 'path') {
      out += this.axisStaircase(m, prec);
    }
    out += this.markers(scr);
    return out;
  }

  // Perpendicular helper — dashed off-axis→foot line + right-angle mark for any
  // point placed with Shift (its `clicked` ≠ `pos`).
  private perpHelper(m: Measurement): string {
    let out = '';
    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i];
      if (!p.clicked) {
        continue;
      }
      const foot = this.toScreen(p.pos);
      const click = this.toScreen(p.clicked);
      if (!foot || !click) {
        continue;
      }
      out += `<line x1="${foot[0]}" y1="${foot[1]}" x2="${click[0]}" y2="${click[1]}" stroke="${PERP_COL}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      out += `<circle cx="${click[0]}" cy="${click[1]}" r="2.5" fill="${PERP_COL}"/>`;
      const prev = i > 0 ? this.toScreen(m.points[i - 1].pos) : null;
      if (prev) {
        const d1 = unit([prev[0] - foot[0], prev[1] - foot[1]]);
        const d2 = unit([click[0] - foot[0], click[1] - foot[1]]);
        const s = 8;
        const a: Pt = [foot[0] + d1[0] * s, foot[1] + d1[1] * s];
        const b: Pt = [a[0] + d2[0] * s, a[1] + d2[1] * s];
        const c: Pt = [foot[0] + d2[0] * s, foot[1] + d2[1] * s];
        out += `<polyline points="${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}" fill="none" stroke="${PERP_COL}" stroke-width="1.5"/>`;
      }
    }
    return out;
  }

  // ΔXYZ staircase (Line/Path): first→last path stepping along X (red), then Y
  // (green), then Z (blue). Each leg + its length label toggles individually.
  private axisStaircase(m: Measurement, prec: number): string {
    if (!m.axisLegs.some((l) => l) && !m.axisLabels.some((l) => l)) {
      return '';
    }
    const first = m.points[0];
    if (!first) {
      return '';
    }
    const sp = span(m);
    let corner = tip(first);
    let out = '';
    for (let ax = 0; ax < 3; ax++) {
      const next: V3 = [...corner];
      next[ax] += sp[ax];
      const a = this.toScreen(corner);
      const b = this.toScreen(next);
      if (a && b) {
        if (m.axisLegs[ax]) {
          // solid white band underneath (1.5px wider) so the dashed leg stays
          // visible on top of busy line-work
          out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#ffffff" stroke-width="3.4"/>`;
          out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${AXIS_COLS[ax]}" stroke-width="1.9" stroke-dasharray="5 3"/>`;
        }
        if (m.axisLabels[ax]) {
          out += this.labelC(
            [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            formatSeg(Math.abs(sp[ax]), prec),
            AXIS_LABEL_COLS[ax],
          );
        }
      }
      corner = next;
    }
    return out;
  }

  // Hover snap glyph: face → disc + normal arrow, edge → bar along the edge,
  // corner → X. Mirrors the native paint_measure_glyph.
  private snapGlyph(hit: MeasureHit): string {
    const c = this.toScreen(hit.point);
    if (!c) {
      return '';
    }
    if (hit.kind === 'corner') {
      const s = 7;
      return (
        `<line x1="${c[0] - s}" y1="${c[1] - s}" x2="${c[0] + s}" y2="${c[1] + s}" stroke="#ff7878" stroke-width="2.5"/>` +
        `<line x1="${c[0] - s}" y1="${c[1] + s}" x2="${c[0] + s}" y2="${c[1] - s}" stroke="#ff7878" stroke-width="2.5"/>`
      );
    }
    if (hit.kind === 'edge') {
      let dir: Pt = [0, 1];
      if (hit.edgeDir) {
        const eye = this.renderer.camera.eye();
        const step = Math.hypot(eye[0] - hit.point[0], eye[1] - hit.point[1], eye[2] - hit.point[2]) * 0.02;
        const p2 = this.toScreen([
          hit.point[0] + hit.edgeDir[0] * step,
          hit.point[1] + hit.edgeDir[1] * step,
          hit.point[2] + hit.edgeDir[2] * step,
        ]);
        if (p2) {
          const v = unit([p2[0] - c[0], p2[1] - c[1]]);
          if (v[0] || v[1]) {
            dir = v;
          }
        }
      }
      return `<line x1="${c[0] - dir[0] * 9}" y1="${c[1] - dir[1] * 9}" x2="${c[0] + dir[0] * 9}" y2="${c[1] + dir[1] * 9}" stroke="${LINE_COL}" stroke-width="2.5"/>`;
    }
    // face
    let out = `<circle cx="${c[0]}" cy="${c[1]}" r="7" fill="none" stroke="#50e6ff" stroke-width="2"/><circle cx="${c[0]}" cy="${c[1]}" r="2" fill="${PT_COL}"/>`;
    if (hit.normal) {
      const eye = this.renderer.camera.eye();
      const len = Math.hypot(eye[0] - hit.point[0], eye[1] - hit.point[1], eye[2] - hit.point[2]) * 0.06;
      const tip2 = this.toScreen([
        hit.point[0] + hit.normal[0] * len,
        hit.point[1] + hit.normal[1] * len,
        hit.point[2] + hit.normal[2] * len,
      ]);
      if (tip2) {
        const v = unit([tip2[0] - c[0], tip2[1] - c[1]]);
        if (v[0] || v[1]) {
          const end: Pt = [c[0] + v[0] * 26, c[1] + v[1] * 26];
          const pp: Pt = [-v[1], v[0]];
          out += `<line x1="${c[0]}" y1="${c[1]}" x2="${end[0]}" y2="${end[1]}" stroke="#50e6ff" stroke-width="2"/>`;
          out += `<line x1="${end[0]}" y1="${end[1]}" x2="${end[0] - v[0] * 7 + pp[0] * 4}" y2="${end[1] - v[1] * 7 + pp[1] * 4}" stroke="#50e6ff" stroke-width="2"/>`;
          out += `<line x1="${end[0]}" y1="${end[1]}" x2="${end[0] - v[0] * 7 - pp[0] * 4}" y2="${end[1] - v[1] * 7 - pp[1] * 4}" stroke="#50e6ff" stroke-width="2"/>`;
        }
      }
    }
    return out;
  }

  private polyline(
    scr: (Pt | null)[],
    kind: MeasureToolKind,
    labels: boolean,
    titled: (v: string) => string,
    m: Measurement,
    prec: number,
  ): string {
    let out = '';
    for (let i = 0; i + 1 < scr.length; i++) {
      const a = scr[i];
      const b = scr[i + 1];
      if (a && b) {
        out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${this.col}" stroke-width="2"/>`;
      }
    }
    if (labels) {
      const segs = segmentLengths(m);
      for (let i = 0; i < segs.length; i++) {
        const a = scr[i];
        const b = scr[i + 1];
        if (!a || !b) {
          continue;
        }
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        // slope before legs: axisLineColors colours the LAST three label lines
        const txt =
          kind === 'line'
            ? titled(formatSeg(segs[i], prec)) + this.slopeSuffix(m, prec) + this.legsSuffix(m, prec)
            : formatSeg(segs[i], prec);
        out += this.label(mid, txt, m.legsInLabel && kind === 'line' ? this.axisLineColors(txt) : undefined);
      }
      if (kind === 'path') {
        const last = scr[scr.length - 1];
        if (last) {
          const txt = titled(valueLabel(m, prec)) + this.legsSuffix(m, prec);
          out += this.label(last, txt, m.legsInLabel ? this.axisLineColors(txt) : undefined);
        }
      }
    }
    return out;
  }

  private polygon(
    scr: (Pt | null)[],
    finished: boolean,
    labels: boolean,
    titled: (v: string) => string,
    m: Measurement,
    prec: number,
  ): string {
    let out = '';
    const n = scr.length;
    for (let i = 0; i < n; i++) {
      const a = scr[i];
      const b = scr[(i + 1) % n];
      if (a && b) {
        out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${this.col}" stroke-width="2"/>`;
      }
    }
    if (finished && n >= 3) {
      const pts = scr.filter((p): p is Pt => !!p);
      if (pts.length === n) {
        out = `<polygon points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="${this.fill}" stroke="none"/>${out}`;
        if (labels) {
          const c: Pt = [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
          out += this.label(c, titled(`${valueLabel(m, prec)}  ⟂${formatSeg(perimeter(m), prec)}`));
        }
      }
    }
    return out;
  }

  // Angle (3 points, vertex = 2nd): both legs + a world-space arc at the
  // vertex; `flipAngle` sweeps the reflex side instead.
  private angle(
    m: Measurement,
    scr: (Pt | null)[],
    labels: boolean,
    titled: (v: string) => string,
    prec: number,
  ): string {
    let out = '';
    // legs vertex→first / vertex→third (during placement: whatever exists)
    for (const i of [0, 2]) {
      const a = scr[1];
      const b = scr[i];
      if (a && b) {
        out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${this.col}" stroke-width="2"/>`;
      }
    }
    if (m.points.length < 3) {
      return out;
    }
    const v = m.points[1].pos;
    const v1 = sub(m.points[0].pos, v);
    const v2 = sub(m.points[2].pos, v);
    const l1 = Math.hypot(...v1);
    const l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9) {
      return out;
    }
    const u = normV(v1);
    // component of v2 perpendicular to u = the arc plane's second axis
    const along = v2[0] * u[0] + v2[1] * u[1] + v2[2] * u[2];
    const wRaw: V3 = [v2[0] - u[0] * along, v2[1] - u[1] * along, v2[2] - u[2] * along];
    if (Math.hypot(...wRaw) < 1e-9) {
      return out; // collinear — no arc plane
    }
    const w = normV(wRaw);
    const theta = Math.acos(Math.max(-1, Math.min(1, along / l2)));
    const sweep = m.flipAngle ? theta - Math.PI * 2 : theta; // reflex goes the long way round
    const r = Math.min(l1, l2) * 0.35;
    const N = 32;
    const arc: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * sweep;
      const p = this.toScreen([
        v[0] + (Math.cos(a) * u[0] + Math.sin(a) * w[0]) * r,
        v[1] + (Math.cos(a) * u[1] + Math.sin(a) * w[1]) * r,
        v[2] + (Math.cos(a) * u[2] + Math.sin(a) * w[2]) * r,
      ]);
      if (p) {
        arc.push(p);
      }
    }
    if (arc.length > 1) {
      out += `<polyline points="${arc.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${this.col}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    }
    if (labels) {
      const mid = arc[Math.floor(arc.length / 2)] ?? this.toScreen(v);
      if (mid) {
        out += this.label(mid, titled(valueLabel(m, prec)));
      }
    }
    return out;
  }

  private diameter(
    m: Measurement,
    scr: (Pt | null)[],
    labels: boolean,
    titled: (v: string) => string,
    prec: number,
  ): string {
    const fit = circleOf(m);
    if (!fit) {
      return this.polyline(scr, 'path', false, titled, m, prec); // fallback: connect the rim points
    }
    const { center, radius } = fit;
    const p0 = m.points[0].pos;
    const p1 = m.points[1].pos;
    const p2 = m.points[2].pos;
    const normal = normV(crossV(sub(p1, p0), sub(p2, p0)));
    if (!(normal[0] || normal[1] || normal[2])) {
      return '';
    }
    const u = normV(Math.abs(normal[0]) < 0.9 ? crossV(normal, [1, 0, 0]) : crossV(normal, [0, 1, 0]));
    const v = crossV(normal, u);
    const ring: Pt[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const w: V3 = [
        center[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * radius,
        center[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * radius,
        center[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * radius,
      ];
      const p = this.toScreen(w);
      if (p) {
        ring.push(p);
      }
    }
    let out = '';
    if (ring.length > 2) {
      out += `<polyline points="${ring.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${this.col}" stroke-width="2"/>`;
    }
    const dA = this.toScreen([center[0] - u[0] * radius, center[1] - u[1] * radius, center[2] - u[2] * radius]);
    const dB = this.toScreen([center[0] + u[0] * radius, center[1] + u[1] * radius, center[2] + u[2] * radius]);
    if (dA && dB) {
      out += `<line x1="${dA[0]}" y1="${dA[1]}" x2="${dB[0]}" y2="${dB[1]}" stroke="${this.col}" stroke-width="2"/>`;
    }
    if (labels) {
      const cc = this.toScreen(center);
      if (cc) {
        out += this.label(cc, titled(valueLabel(m, prec)));
      }
    }
    return out;
  }

  // Face (2 points): perpendicular gap from the second pick to the first
  // pick's face plane — solid measured segment second→foot, dashed in-plane
  // tie back to the first pick, right-angle mark at the foot. Falls back to a
  // plain point-to-point line when the first pick has no usable normal.
  private faceDist(
    m: Measurement,
    scr: (Pt | null)[],
    labels: boolean,
    titled: (v: string) => string,
    prec: number,
  ): string {
    const g = faceGap(m);
    if (!g) {
      return '';
    }
    const a = scr[0];
    const b = scr[1];
    if (!g.foot) {
      let out = '';
      if (a && b) {
        out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${this.col}" stroke-width="2"/>`;
        if (labels) {
          out += this.label([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], titled(valueLabel(m, prec)));
        }
      }
      return out;
    }
    const foot = this.toScreen(g.foot);
    if (!foot || !b) {
      return '';
    }
    let out = `<line x1="${b[0]}" y1="${b[1]}" x2="${foot[0]}" y2="${foot[1]}" stroke="${this.col}" stroke-width="2"/>`;
    if (a) {
      out += `<line x1="${foot[0]}" y1="${foot[1]}" x2="${a[0]}" y2="${a[1]}" stroke="${PERP_COL}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      const d1 = unit([a[0] - foot[0], a[1] - foot[1]]);
      const d2 = unit([b[0] - foot[0], b[1] - foot[1]]);
      if ((d1[0] || d1[1]) && (d2[0] || d2[1])) {
        const s = 8;
        const p1: Pt = [foot[0] + d1[0] * s, foot[1] + d1[1] * s];
        const p2: Pt = [p1[0] + d2[0] * s, p1[1] + d2[1] * s];
        const p3: Pt = [foot[0] + d2[0] * s, foot[1] + d2[1] * s];
        out += `<polyline points="${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}" fill="none" stroke="${PERP_COL}" stroke-width="1.5"/>`;
      }
    }
    out += `<circle cx="${foot[0]}" cy="${foot[1]}" r="2.5" fill="${PERP_COL}"/>`;
    if (labels) {
      out += this.label([(b[0] + foot[0]) / 2, (b[1] + foot[1]) / 2], titled(valueLabel(m, prec)));
    }
    return out;
  }
}

function formatSeg(v: number, prec: number): string {
  // segment length label without the trailing Σ/Ø prefixes
  const s = Math.abs(v).toFixed(prec);
  const [i, f] = s.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${f ? `${g}.${f}` : g} m`;
}
