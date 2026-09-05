// Measurement actions — point placement, finishing, and the list/save/load, all
// mirroring the native `MeasurementSet` + `Ui::measure_*` methods.
import { downloadText } from '../../lib/download';
import type { V3 } from '../../lib/math/quat';
import {
  autoFinishAt,
  lockProject,
  type MeasureHit,
  type MeasureLock,
  type Measurement,
  type MeasurePoint,
  type MeasureToolKind,
  measurementsState,
  minPoints,
  perpProject,
  type SnapConfig,
} from './measurements.state';
import { readSphereMarker, type SphereMarker } from './sphereMarker';

const KIND_LABEL: Record<MeasureToolKind, string> = {
  point: 'Point',
  line: 'Line',
  path: 'Path',
  area: 'Area',
  diameter: 'Diameter',
  angle: 'Angle',
  face: 'Face',
};

/** Squared distance — drops a trailing near-duplicate vertex on finish (the
 *  extra vertex a double-click leaves behind). */
function near(a: V3, b: V3): boolean {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz < 1e-8;
}

export const measurementsActions = {
  /** Select the active tool (called from the ribbon). Switching cancels any
   *  in-progress measurement. */
  setTool(kind: MeasureToolKind | null) {
    measurementsState.set({ activeKind: kind, inProgress: [], hover: null });
  },

  /** Place a point from a hover-probe hit. Auto-finishes Line (2) / Diameter
   *  (3); Path/Area stay open until finish(). With Shift (`perp`) the point is
   *  the perpendicular foot on the previous point's normal ray; the raw click is
   *  kept as `clicked` for the dashed helper + ΔXYZ staircase. */
  addPoint(hit: MeasureHit) {
    const s = measurementsState.get();
    const kind = s.activeKind;
    if (!kind) {
      return;
    }
    const prev = s.inProgress[s.inProgress.length - 1];
    let point: MeasurePoint =
      prev && s.perp
        ? { pos: perpProject(prev, hit.point), normal: hit.normal, clicked: hit.point }
        : { pos: hit.point, normal: hit.normal };
    if (s.lock !== 'none') {
      const locked = lockProject(s.lock, s.inProgress, point.pos);
      if (locked !== point.pos) {
        point = { ...point, pos: locked, clicked: hit.point };
      }
    }
    const inProgress = [...s.inProgress, point];
    measurementsState.set({ inProgress });
    const auto = autoFinishAt(kind);
    if (auto !== null && inProgress.length >= auto) {
      this.finish();
    }
  },

  /** Commit the in-progress measurement if it has enough points. */
  finish() {
    const s = measurementsState.get();
    const kind = s.activeKind;
    if (!kind) {
      return;
    }
    let pts = s.inProgress;
    // drop a trailing near-duplicate (the double-click leftover)
    if (pts.length > minPoints(kind) && near(pts[pts.length - 1].pos, pts[pts.length - 2].pos)) {
      pts = pts.slice(0, -1);
    }
    if (pts.length < minPoints(kind)) {
      return;
    }
    const n = s.items.filter((m) => m.kind === kind).length + 1;
    const item: Measurement = {
      id: s.nextId + 1,
      kind,
      points: pts,
      label: `${KIND_LABEL[kind]} ${n}`,
      visible: true,
      showLabel: true,
      showPerp: false,
      axisLegs: [false, false, false],
      axisLabels: [false, false, false],
      legsInLabel: false,
      slopeInLabel: false,
    };
    measurementsState.set({ items: [...s.items, item], inProgress: [], nextId: s.nextId + 1 });
  },

  /** Discard the in-progress points (Esc). */
  cancel() {
    measurementsState.set({ inProgress: [], hover: null });
  },

  /** Remove the last placed in-progress point (Backspace). */
  undoPoint() {
    measurementsState.set((s) => ({ inProgress: s.inProgress.slice(0, -1) }));
  },

  /** Live hover-probe hit for the rubber-band + snap glyph. */
  setHover(hit: MeasureHit | null) {
    measurementsState.set({ hover: hit });
  },

  /** Shift = perpendicular placement (set from the viewport key state). */
  setPerp(perp: boolean) {
    if (measurementsState.get().perp !== perp) {
      measurementsState.set({ perp });
    }
  },

  /** Placement lock (ribbon Lock section) — clicking the active one turns it off. */
  setLock(lock: MeasureLock) {
    measurementsState.set({ lock });
  },

  /** Angle only: toggle between the inner (θ) and reflex (360°−θ) angle. */
  toggleFlipAngle(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, flipAngle: !m.flipAngle } : m)),
    }));
  },

  remove(id: number) {
    measurementsState.set((s) => ({ items: s.items.filter((m) => m.id !== id) }));
  },

  clear() {
    measurementsState.set({ items: [], inProgress: [] });
  },

  toggleVisible(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)),
    }));
  },

  toggleShowLabel(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, showLabel: !m.showLabel } : m)),
    }));
  },

  toggleShowPerp(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, showPerp: !m.showPerp } : m)),
    }));
  },

  /** Toggle one ΔXYZ leg (axis 0/1/2). */
  toggleAxisLeg(id: number, axis: 0 | 1 | 2) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => {
        if (m.id !== id) {
          return m;
        }
        const axisLegs: [boolean, boolean, boolean] = [...m.axisLegs];
        axisLegs[axis] = !axisLegs[axis];
        return { ...m, axisLegs };
      }),
    }));
  },

  /** Toggle one ΔXYZ length label (axis 0/1/2). */
  toggleAxisLabel(id: number, axis: 0 | 1 | 2) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => {
        if (m.id !== id) {
          return m;
        }
        const axisLabels: [boolean, boolean, boolean] = [...m.axisLabels];
        axisLabels[axis] = !axisLabels[axis];
        return { ...m, axisLabels };
      }),
    }));
  },

  /** Append the ΔX/ΔY/ΔZ lengths to the measurement's main viewport label. */
  toggleLegsInLabel(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, legsInLabel: !m.legsInLabel } : m)),
    }));
  },

  /** Append the slope (∠ from horizontal + % fall) to a line's viewport label. */
  toggleSlopeInLabel(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, slopeInLabel: !m.slopeInLabel } : m)),
    }));
  },

  /** XYZ master: turn all three legs on (or all off if already all on). */
  toggleAllAxisLegs(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => {
        if (m.id !== id) {
          return m;
        }
        const on = !m.axisLegs.every((l) => l);
        return { ...m, axisLegs: [on, on, on] };
      }),
    }));
  },

  setSnap(patch: Partial<SnapConfig>) {
    measurementsState.set((s) => ({ snap: { ...s.snap, ...patch } }));
  },

  setLabel(id: number, label: string) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, label } : m)),
    }));
  },

  /** Per-row sphere toggle: on with the Config default, or off. */
  toggleSphere(id: number) {
    measurementsState.set((s) => ({
      items: s.items.map((m) => (m.id === id ? { ...m, sphere: m.sphere ? null : { ...s.sphere } } : m)),
    }));
  },

  /** Config → Point sphere: the default for the row toggle, applied to every
   *  measurement that currently shows spheres too. */
  setSphereDefault(patch: Partial<SphereMarker>) {
    measurementsState.set((s) => ({
      sphere: { ...s.sphere, ...patch },
      items: s.items.map((m) => (m.sphere ? { ...m, sphere: { ...m.sphere, ...patch } } : m)),
    }));
  },

  /** Step the point sphere radius (drives the number-input +/- hotkeys). */
  bumpSphereSize(delta: number) {
    const size = Math.max(0.01, +(measurementsState.get().sphere.size + delta * 0.05).toFixed(3));
    this.setSphereDefault({ size });
  },

  /** Config → Spheres on / off: every measurement gets the Config sphere, or
   *  none — all off when every one already has spheres, else all on. */
  toggleAllSpheres() {
    measurementsState.set((s) => {
      const allOn = s.items.length > 0 && s.items.every((m) => m.sphere);
      return { items: s.items.map((m) => ({ ...m, sphere: allOn ? null : { ...s.sphere } })) };
    });
  },

  /** Filled spheres (shaded, with opacity) instead of wireframes. */
  toggleSphereSolid() {
    this.setSphereDefault({ solid: !measurementsState.get().sphere.solid });
  },

  /** Step the solid spheres' fill opacity (hotkeys); 1 = opaque. */
  bumpSphereOpacity(delta: number) {
    const cur = measurementsState.get().sphere.opacity;
    this.setSphereDefault({ opacity: Math.min(1, Math.max(0.05, +(cur + delta * 0.05).toFixed(3))) });
  },

  toggleMuted() {
    measurementsState.set((s) => ({ muted: !s.muted }));
  },

  setPrecision(precision: number) {
    measurementsState.set({ precision: Math.max(0, Math.min(6, Math.round(precision))) });
  },

  /** Viewport colour for every measurement (lines, markers, area fill). */
  setLineColor(lineColor: string) {
    measurementsState.set({ lineColor });
  },

  /** Step the decimals value (drives the number-input +/- hotkeys). */
  bumpPrecision(delta: number) {
    this.setPrecision(measurementsState.get().precision + delta);
  },

  /** Toggle one snap flag (hotkeys for the Snapping checkboxes). */
  toggleSnap(field: 'enabled' | 'corner' | 'edge' | 'seam') {
    measurementsState.set((s) => ({ snap: { ...s.snap, [field]: !s.snap[field] } }));
  },

  /** Clamp-step a snap pixel radius (hotkeys for the sensitivity steppers). */
  bumpSnapPx(field: 'cornerPx' | 'edgePx', delta: number) {
    measurementsState.set((s) => ({
      snap: { ...s.snap, [field]: Math.max(2, Math.min(40, s.snap[field] + delta)) },
    }));
  },

  /** Save all measurements to a downloaded JSON file (the panel's Save…). */
  downloadJson() {
    downloadText('measurements.json', this.exportJson());
  },

  /** Serialize the measurement set (items + mute) for sharing/backup. */
  exportJson(): string {
    const s = measurementsState.get();
    return JSON.stringify(
      { items: s.items, muted: s.muted, precision: s.precision, lineColor: s.lineColor },
      (_k, v) => (typeof v === 'number' ? +v.toFixed(6) : v),
      2,
    );
  },

  /** Load a measurement set, replacing the current one. Returns the count. */
  importJson(text: string): number {
    const data = JSON.parse(text) as {
      items?: Measurement[];
      muted?: boolean;
      precision?: number;
      lineColor?: string;
    };
    const items = (data.items ?? []).filter((m) => m && Array.isArray(m.points) && typeof m.kind === 'string');
    let nextId = 0;
    for (const m of items) {
      m.visible = m.visible ?? true;
      m.showLabel = m.showLabel ?? true;
      m.showPerp = m.showPerp ?? false;
      m.axisLegs = m.axisLegs ?? [false, false, false];
      m.axisLabels = m.axisLabels ?? [false, false, false];
      m.legsInLabel = m.legsInLabel ?? false;
      m.slopeInLabel = m.slopeInLabel ?? false;
      m.flipAngle = m.flipAngle ?? false;
      m.label = m.label ?? '';
      m.sphere = readSphereMarker(m.sphere);
      nextId = Math.max(nextId, m.id ?? 0);
    }
    measurementsState.set({
      items,
      muted: data.muted ?? false,
      precision: data.precision ?? 3,
      lineColor: data.lineColor ?? '#000000',
      inProgress: [],
      nextId,
    });
    return items.length;
  },
};
