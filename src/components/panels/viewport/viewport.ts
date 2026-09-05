import { projectToScreen } from '../../../lib/math/project';
import { ClipGizmo, type GizmoTargets } from '../../../lib/overlay/ClipGizmo';
import { LabelOverlay } from '../../../lib/overlay/LabelOverlay';
import { MeasureOverlay } from '../../../lib/overlay/MeasureOverlay';
import { ResidencyBoxOverlay } from '../../../lib/overlay/ResidencyBoxOverlay';
import { isMobileDevice } from '../../../lib/render/device';
import type { MeasureProbe } from '../../../lib/render/renderer';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { type MeasureHit, measurementsState } from '../../../state/viewer/measurements.state';
import { setClipShapeSeed } from '../clip-shapes/ribbonClipShapes.actions';
import { buildClip, sph } from './clipPack';
import { shapeGizmoTarget } from './shapeGizmo';

/** Adapt the renderer's probe (null fields) to the state's MeasureHit (optional). */
function toHit(p: MeasureProbe | null): MeasureHit | null {
  return p ? { point: p.point, normal: p.normal ?? undefined, edgeDir: p.edgeDir ?? undefined, kind: p.kind } : null;
}

/** Snap config for the measure probe — the Face tool needs a face hit (its
 *  reference plane comes from the surface normal), so corner/edge snap is
 *  bypassed while it is active. */
function measureSnap() {
  const s = measurementsState.get();
  return s.activeKind === 'face' ? { ...s.snap, corner: false, edge: false } : s.snap;
}

import type { PanelDefinition } from '@treDeSpaceUI/dockable';
import { ViewGizmo } from '../../../lib/overlay/ViewGizmo';
import { Renderer } from '../../../lib/render/renderer';
import { buildViewCubeGeometry } from '../../../lib/render/viewCubeGpu';
import { clipShapesState } from '../../../state/viewer/clipShapes.state';
import { db, transfer } from '../../../state/viewer/db';
import { gizmoLabelsState } from '../../../state/viewer/gizmoLabels.state';
import { labelsActions } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { navActions, navState } from '../../../state/viewer/nav.state';
import { residency } from '../../../state/viewer/residency';
import { selectionState } from '../../../state/viewer/selection.state';
import { collectStats, formatOverlay } from '../../../state/viewer/statsRows';
import { registerRenderer, viewerActions } from '../../../state/viewer/viewer.actions';
import { viewerState } from '../../../state/viewer/viewer.state';
import { vramBudgetMb } from '../../../state/viewer/vramBudget';
import { consoleActions } from '../console/console.actions';
import { ribbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';
import { ribbonClippingPlaneActions } from '../ribbon-clipping-plane/ribbonClippingPlane.actions';
import { ribbonClippingPlaneState } from '../ribbon-clipping-plane/ribbonClippingPlane.state';
import { ribbonSelectionTransformActions } from '../ribbon-selection-transform/ribbonSelectionTransform.actions';
import { ribbonSelectionTransformState } from '../ribbon-selection-transform/ribbonSelectionTransform.state';
import { settingsState } from '../settings/settings.state';
import { concatLines, MarkerCache } from './markerLines';

function hexRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** Camera world-orientation quaternion (columns right/up/back) for the gizmo. */
function cameraQuat(fwd: [number, number, number]): { x: number; y: number; z: number; w: number } {
  const rl = Math.hypot(fwd[0], fwd[1]) || 1;
  const r = [fwd[1] / rl, -fwd[0] / rl, 0];
  const u = [r[1] * fwd[2], -r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
  const b = [-fwd[0], -fwd[1], -fwd[2]];
  const m00 = r[0],
    m01 = u[0],
    m02 = b[0];
  const m10 = r[1],
    m11 = u[1],
    m12 = b[1];
  const m20 = r[2],
    m21 = u[2],
    m22 = b[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  return { x, y, z, w };
}

/**
 * The WebGPU viewport: no React inside — the dock reparents the host element,
 * so the WebGPU context and every GPU buffer survive dock/split/float/tab
 * moves without re-initialising.
 */
export const viewport: PanelDefinition = {
  id: 'viewport',
  title: 'Viewport',
  minWidth: 260,
  minHeight: 180,
  closable: false,

  render(host) {
    host.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);

    // HUD is two stacked divs: the GPU error is its OWN div (selectable +
    // copyable, since the stats below it re-render every frame and would
    // otherwise clobber a text selection); stats stay pointer-events:none.
    const hudWrap = document.createElement('div');
    hudWrap.style.cssText =
      'position:absolute;top:6px;left:8px;display:flex;flex-direction:column;gap:6px;' +
      'max-width:calc(100% - 16px);z-index:5;';
    const errHud = document.createElement('div');
    errHud.style.cssText =
      'font:11px monospace;color:#ff8a8a;white-space:pre-wrap;word-break:break-word;' +
      'pointer-events:auto;user-select:text;cursor:text;display:none;' +
      'background:rgba(30,10,10,0.85);border:1px solid #7f1d1d;border-radius:3px;padding:4px 6px;';
    errHud.title = 'GPU error — select to copy';
    const hud = document.createElement('div');
    hud.style.cssText =
      'font:11px monospace;color:#dfe3ea;white-space:pre;pointer-events:none;text-shadow:0 1px 2px #000;';
    hudWrap.append(errHud, hud);
    host.appendChild(hudWrap);

    // VRAM-budget activity chip (top-right; the view cube sits bottom-right).
    // Dimmed backdrop so the text reads against any scene; hidden while empty.
    const vramHud = document.createElement('div');
    vramHud.style.cssText =
      'position:absolute;top:6px;right:8px;font:11px monospace;pointer-events:none;' +
      'text-shadow:0 1px 2px #000;z-index:5;display:none;padding:2px 7px;' +
      'background:rgba(15,23,42,0.65);border:1px solid rgba(148,163,184,0.25);backdrop-filter:blur(2px);';
    host.appendChild(vramHud);

    // Two on-screen joysticks (tablet): LEFT = move (feeds padMove, leaves orbit
    // like WASD), RIGHT = look/direction (feeds padLook). They mirror: both sit
    // joystickY% from the top and joystickX% IN FROM THEIR OWN SIDE, so one pair
    // of numbers positions both. (Direct canvas touch still looks; two fingers pan.)
    type Pad = { el: HTMLDivElement; reset: () => void; place: (hw: number, hh: number) => void };
    const makePad = (kind: 'move' | 'look', side: 'left' | 'right'): Pad => {
      const el = document.createElement('div');
      // position (left/top of its CENTRE) is set from viewer state each frame
      el.style.cssText =
        'position:absolute;width:224px;height:224px;border-radius:50%;transform:translate(-50%,-50%);' +
        'border:1px solid rgba(148,163,184,0.5);background:rgba(15,23,42,0.35);z-index:6;' +
        'display:none;touch-action:none;backdrop-filter:blur(2px);' +
        // stop the long-press selection / iOS callout / context menu on touch
        'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
      const knob = document.createElement('div');
      knob.style.cssText =
        'position:absolute;left:50%;top:50%;width:88px;height:88px;border-radius:50%;' +
        'transform:translate(-50%,-50%);background:rgba(148,163,184,0.55);border:1px solid rgba(203,213,225,0.7);';
      el.appendChild(knob);
      host.appendChild(el);
      let pointer = -1;
      const setKnob = (nx: number, ny: number) => {
        knob.style.transform = `translate(calc(-50% + ${nx * 68}px), calc(-50% + ${ny * 68}px))`;
      };
      const apply = (nx: number, ny: number) => {
        if (kind === 'move') {
          renderer.camera.padMove = [nx, -ny]; // up = forward
          // like WASD: pushing the stick leaves orbit for fly/walk (per settings)
          if (Math.hypot(nx, ny) > 0.05) {
            renderer.camera.onMoveKey?.();
          }
        } else {
          renderer.camera.padLook = [nx, ny]; // right = turn right, down = look down
        }
      };
      const input = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const len = Math.hypot(dx, dy);
        const nx = len > 1 ? dx / len : dx;
        const ny = len > 1 ? dy / len : dy;
        apply(nx, ny);
        setKnob(nx, ny);
      };
      const reset = () => {
        pointer = -1;
        if (kind === 'move') {
          renderer.camera.padMove = [0, 0];
        } else {
          renderer.camera.padLook = [0, 0];
        }
        setKnob(0, 0);
      };
      el.addEventListener('pointerdown', (e) => {
        pointer = e.pointerId;
        el.setPointerCapture(e.pointerId);
        input(e);
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId === pointer) {
          input(e);
        }
      });
      el.addEventListener('pointerup', reset);
      el.addEventListener('pointercancel', reset);
      // a held touch would otherwise pop the browser context menu
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      const place = (hw: number, hh: number) => {
        const vp = viewerState.get();
        const inset = (vp.joystickX / 100) * hw; // distance in from this pad's side
        const cx = side === 'left' ? inset : hw - inset;
        const cy = (vp.joystickY / 100) * hh;
        el.style.left = `${Math.min(Math.max(cx, 112), hw - 112)}px`;
        el.style.top = `${Math.min(Math.max(cy, 112), hh - 112)}px`;
      };
      return { el, reset, place };
    };
    const pads: Pad[] = [makePad('move', 'left'), makePad('look', 'right')];

    /** Set the error div's text (and show/hide it) only when it changes, so a
     *  selection inside it survives the per-frame stats updates. */
    const setError = (msg: string) => {
      if (errHud.textContent === msg) {
        return;
      }
      errHud.textContent = msg;
      errHud.style.display = msg ? 'block' : 'none';
    };

    const renderer = new Renderer();
    let frame = 0;
    let disposed = false;
    let gizmo: ViewGizmo | null = null;
    let clipGizmo: ClipGizmo | null = null;
    let measureOverlay: MeasureOverlay | null = null;
    let labelOverlay: LabelOverlay | null = null;
    let residencyBoxes: ResidencyBoxOverlay | null = null;
    let removeMeasureKeys: (() => void) | null = null;
    // selection-gizmo drag bookkeeping: the live preview matrix (gizmo rides
    // along) and the pivot position frozen at pivot-drag start
    let liveMatrix: Float32Array | null = null;
    let pivotDragBase: [number, number, number] = [0, 0, 0];
    const clipGizmoDragging = () => clipGizmo?.dragging ?? false;

    const gizmoTargets = (): GizmoTargets => {
      const box = ribbonClippingBoxState.get();
      const planes = ribbonClippingPlaneState.get();
      const { min, max } = renderer.sceneBounds;
      const center: [number, number, number] = Number.isFinite(min[0])
        ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
        : [0, 0, 0];
      // first enabled plane in rotate mode gets the normal handle
      const AXES = ['x', 'y', 'z'] as const;
      const COLORS = ['#ef4444', '#16a34a', '#3b82f6'];
      // every enabled plane whose Gizmo toggle is on gets its own handles:
      // move arrows normally, rotation rings when rotate mode is active
      const planeTargets: GizmoTargets['planes'] = [];
      AXES.forEach((axis, i) => {
        const pl = planes[axis];
        if (!pl.enabled || !pl.gizmo) {
          return;
        }
        const base = pl.anchor ?? center;
        const n = sph(pl.el, pl.az);
        planeTargets.push({
          mode: pl.rotateMode ? 'rotate' : 'move',
          anchor: [base[0] + n[0] * pl.position, base[1] + n[1] * pl.position, base[2] + n[2] * pl.position],
          normal: n,
          color: COLORS[i],
          onRotate: (el, az) => {
            ribbonClippingPlaneActions.setEl(axis, el);
            ribbonClippingPlaneActions.setAz(axis, az);
          },
          onMove: (p) => {
            // new plane point -> back out the anchor (point = anchor + n*position)
            ribbonClippingPlaneActions.setAnchor(axis, [
              p[0] - n[0] * pl.position,
              p[1] - n[1] * pl.position,
              p[2] - n[2] * pl.position,
            ]);
          },
        });
      });
      // selection transform gizmo (Transform ribbon): world axes at the
      // selection center (or the locked pivot for rotate/scale); drags
      // preview via model_global and bake on release. In pivot-placement
      // mode the same arrows move the PIVOT instead of the geometry.
      const tr = ribbonSelectionTransformState.get();
      const selSt = selectionState.get();
      let sel: GizmoTargets['sel'] = null;
      if (tr.pivotSetting && tr.pivot) {
        const base: [number, number, number] = [...tr.pivot];
        sel = {
          mode: 'pivot',
          center: base,
          // g is a pure translation relative to drag start; the gizmo
          // captured `center` at pointerdown so base+g is the new pivot
          onDrag: (g) =>
            ribbonSelectionTransformActions.movePivot([
              pivotDragBase[0] + g[12],
              pivotDragBase[1] + g[13],
              pivotDragBase[2] + g[14],
            ]),
          // nothing to bake — the base re-syncs to the pivot once the drag ends
          onCommit: () => {},
        };
        if (!clipGizmoDragging()) {
          pivotDragBase = base;
        }
      } else if (tr.gizmoMode !== 'none' && selSt.count > 0 && selSt.bounds) {
        const { min: bmin, max: bmax } = selSt.bounds;
        let center: [number, number, number] =
          tr.pivot && tr.gizmoMode !== 'move'
            ? [...tr.pivot]
            : [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
        // live drag: the gizmo rides along with the previewed group transform
        if (liveMatrix) {
          const g = liveMatrix;
          center = [
            g[0] * center[0] + g[4] * center[1] + g[8] * center[2] + g[12],
            g[1] * center[0] + g[5] * center[1] + g[9] * center[2] + g[13],
            g[2] * center[0] + g[6] * center[1] + g[10] * center[2] + g[14],
          ];
        }
        sel = {
          mode: tr.gizmoMode,
          center,
          onDrag: (g) => {
            liveMatrix = g;
            viewerActions.liveSelectionTransform(g);
          },
          onCommit: (g) =>
            void viewerActions.bakeSelectionTransform(g).then(() => {
              liveMatrix = null; // bounds are refreshed; drop the preview offset
            }),
        };
      }
      // armed clip SHAPE takes the box-gizmo slot; the default box is fallback
      const shapeTarget = shapeGizmoTarget();
      return {
        sel,
        box:
          shapeTarget ??
          (box.enabled && box.boxOn && box.helper && box.gizmoMode !== 'none'
            ? {
                mode: box.gizmoMode === 'scale' && box.sixAxis ? 'faces' : box.gizmoMode,
                center: [...box.center],
                size: [...box.size],
                rotation: [...box.rotation],
                onChange: (c, sz) => ribbonClippingBoxState.set({ center: c, size: sz }),
                onRotate: (q) => ribbonClippingBoxState.set({ rotation: q }),
              }
            : null),
        planes: planeTargets,
      };
    };

    // marker spheres for labels / measurement points, merged into the clip
    // helper line list (one depth-tested draw); rebuilt only on change
    const markerLines = new MarkerCache();
    const applyOptions = () => {
      const s = viewerState.get();
      const o = renderer.options;
      o.orthographic = s.orthographic;
      o.vertexPull = s.vertexPull;
      o.meshletVis = s.meshletVis;
      o.pxCut = s.pxCutEnabled ? s.pxCut : 0;
      o.protectDist = s.protectDist;
      o.pickOpacityPct = s.pickOpacityPct;
      o.fastAA = s.fastAA;
      o.msaa4x = s.msaa4x;
      // smart wins over both manual fields: mobile = 1, desktop = native DPR
      o.pixelRatio = s.smartPixelRatio ? (isMobileDevice() ? 1 : null) : s.useDevicePixelRatio ? null : s.pixelRatio;
      o.freezeCull = s.freezeCull;
      o.geoEdges = s.geoEdges;
      o.itemEdges = s.itemEdges;
      o.sketch = s.sketch;
      // sketch mode swaps in its own edge tuning (Settings → Edges → Sketch edges)
      o.edgeColor = hexRgb(s.sketch ? s.sketchEdgeColor : s.edgeColor);
      // …and its own view-cube palette (Settings → Gizmo / Sketch edges)
      renderer.setViewCubeColors(
        hexRgb(s.sketch ? s.sketchCubeFaceColor : s.cubeFaceColor),
        hexRgb(s.sketch ? s.sketchCubeLineColor : s.cubeLineColor),
        hexRgb(s.sketch ? s.sketchCubeHoverColor : s.cubeHoverColor),
        s.sketch ? s.sketchCubeTextColor : s.cubeTextColor,
      );
      o.fadeExp = s.sketch ? s.sketchFadeExp : s.fadeExp;
      o.depthThr = s.sketch ? s.sketchDepthThr : s.depthThr;
      o.normalThr = s.sketch ? s.sketchNormalThr : s.normalThr;
      o.whiteOnDark = s.whiteOnDark;
      o.darkThr = s.darkThr;
      o.darkFloor = s.darkLift ? s.darkLiftPct / 100 : 0;
      // sketch mode overrides BOTH threshold sets for one uniform line look
      o.smoothFadeExp = s.sketch ? s.sketchFadeExp : s.smoothFadeExp;
      o.smoothDepthThr = s.sketch ? s.sketchDepthThr : s.smoothDepthThr;
      o.smoothNormalThr = s.sketch ? s.sketchNormalThr : s.smoothNormalThr;
      o.flatMeshEdges = s.flatMeshEdges;
      o.smoothMeshEdges = s.smoothMeshEdges;
      o.sketchRespectsEdgesOff = s.sketchRespectsEdgesOff;
      o.sketchColorMode = s.sketchColorMode;
      o.aoMode = s.aoMode;
      o.aoRadius = s.aoRadius;
      o.aoStrength = s.aoStrength;
      o.aoSlices = s.aoSlices;
      o.aoSamples = s.aoSamples;
      o.debugBuf = s.debugBuf;
      o.traceKey = s.trace;
      const clip = buildClip(renderer);
      renderer.setClip(clip.data);
      const labels = labelsState.get();
      const measures = measurementsState.get();
      const markers = markerLines.update(labels.items, labels.muted, measures.items, measures.muted);
      renderer.setHelperLines(concatLines(clip.lines, markers), `${clip.lines.join(',')}|${markerLines.version}`);
      renderer.setMarkerSpheres(markerLines.instances, markerLines.opaqueCount, `${markerLines.version}`);
      // Seed a new clip shape at the scene centre with a scene-scaled radius.
      const { min, max } = renderer.sceneBounds;
      if (Number.isFinite(min[0])) {
        setClipShapeSeed(
          [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
          Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.15),
        );
      }
      o.bgColor = hexRgb(s.bgColor);
      o.selectionColor = hexRgb(s.selectionColor);
      o.suppressTintOnOverride = s.suppressTintOnOverride;
      o.gpuTimings = s.gpuTimings;
      o.transparencyBlend = s.transparencyBlend;
      o.transparencyBackdrop = s.transparencyBackdrop;
      o.backdropFade = s.backdropFadePct / 100;
      o.hasTransparency = s.hasTransparency;
      o.aaSamples = s.aaSamples;
      o.ambientColor = hexRgb(s.ambientColor);
      o.ambientIntensity = s.ambientIntensity;
      o.headlightColor = hexRgb(s.headlightColor);
      o.headlightIntensity = s.headlightIntensity;
      // outline effect (selection style: tint / outline / both)
      o.outlineHover = s.outlineHover;
      o.outlineSelection = s.selectionStyle !== 'tint';
      o.selectionTint = s.selectionStyle !== 'outline';
      o.outlineStrength = s.outlineStrength;
      o.outlineGlow = s.outlineGlow;
      o.outlineThickness = s.outlineThickness;
      o.outlinePulse = s.outlinePulse;
      o.outlineVisibleColor = hexRgb(s.outlineVisibleColor);
      o.outlineHiddenColor = hexRgb(s.outlineHiddenColor);
      o.outlineSelectionActive = selectionState.get().count > 0;
      // camera navigation (walk/fly + speeds) from the nav settings store
      const nav = navState.get();
      const cam = renderer.camera;
      cam.navMode = nav.mode;
      cam.onMoveKey = navActions.keysActivate;
      cam.onOrbitIntent = navActions.orbitActivate;
      cam.flySpeed = nav.flySpeed;
      cam.flyShift = nav.flyShift;
      cam.walkSpeed = nav.walkSpeed;
      cam.walkShift = nav.walkShift;
      cam.orbitSens = nav.orbitSens;
      cam.panSens = nav.panSens;
      cam.keyPanSens = nav.keyPanSens;
      renderer.fitDense = viewerState.get().fitDense;
      const showPads = viewerState.get().touchPads;
      const hw = host.clientWidth || 1;
      const hh = host.clientHeight || 1;
      for (const p of pads) {
        if ((p.el.style.display === 'none') === showPads) {
          p.el.style.display = showPads ? 'block' : 'none';
          if (!showPads) {
            p.reset();
          }
        }
        if (showPads) {
          p.place(hw, hh);
        }
      }
    };

    // applyOptions reads a handful of stores and the host size; re-running it
    // every tick cost more at rest than the (idle) renderer itself, so it runs
    // only after one of its inputs changed
    let optionsDirty = true;
    const markOptionsDirty = () => {
      optionsDirty = true;
    };
    const unsubOptions = [
      viewerState,
      navState,
      selectionState,
      clipShapesState,
      ribbonClippingBoxState,
      ribbonClippingPlaneState,
      labelsState,
      measurementsState,
    ].map((store) => store.subscribe(markOptionsDirty));
    const hostResize = new ResizeObserver(markOptionsDirty);
    hostResize.observe(host);

    const boot = async () => {
      try {
        renderer.gpuPreference = settingsState.get().gpu;
        await renderer.init(canvas);
      } catch (e) {
        setError(String(e));
        consoleActions.log('error', String(e));
        return;
      }
      if (disposed) {
        renderer.dispose(); // unmounted while init was in flight
        return;
      }
      registerRenderer(renderer);
      if (!renderer.multiDraw) {
        // no MDI: vertex-pull culling is the only GPU-driven path — default on
        viewerState.set({ vertexPull: true });
      }
      consoleActions.log('info', `WebGPU: ${renderer.adapterInfo}`);
      consoleActions.log(
        renderer.multiDraw ? 'info' : 'warn',
        renderer.multiDraw
          ? 'multi-draw indirect + GPU culling active'
          : 'no chromium-experimental-multi-draw-indirect — using vertex-pull culling',
      );

      clipGizmo = new ClipGizmo(host, renderer, gizmoTargets);
      measureOverlay = new MeasureOverlay(host, renderer);
      labelOverlay = new LabelOverlay(host, renderer);
      residencyBoxes = new ResidencyBoxOverlay(host, renderer);
      // The cube is DRAWN by the renderer (GPU overlay — so canvas captures
      // include it); the DOM ViewGizmo stays as invisible hit zones + handle.
      const cubeZones = buildViewCubeGeometry().zoneIds; // pick.id → zone id
      let cubeHover = -1;
      gizmo = new ViewGizmo(host, {
        visual: false,
        // bottom-right by default (it stays draggable via its handle)
        position: { right: 12, bottom: 12 },
        onPick({ direction: [dx, dy, dz] }) {
          // position the camera along +direction, looking back at the pivot:
          // forward (camera -> target) = -direction. Straight up/down (top/
          // bottom face) has no azimuth of its own — keep the current one so
          // the camera just pitches instead of also yawing to 0.
          const az = Math.hypot(dx, dy) < 1e-3 ? renderer.camera.azimuth : Math.atan2(-dy, -dx);
          renderer.camera.snapView(az, Math.asin(Math.max(-1, Math.min(1, -dz))), 0.35);
        },
        onHover(pick) {
          cubeHover = pick ? (cubeZones[pick.id] ?? -1) : -1;
        },
      });
      renderer.setViewCubeLabels({ ...gizmoLabelsState.get().labels });
      const unsubLabels = gizmoLabelsState.subscribe(() => {
        renderer.setViewCubeLabels({ ...gizmoLabelsState.get().labels });
      });
      void unsubLabels; // released with the panel below
      const cubeHoverId = () => cubeHover;

      // dev auto-load: ?auto=/@fs/abs/path/a.model,...
      const auto = new URLSearchParams(location.search).get('auto');
      if (auto) {
        for (const url of auto.split(',')) {
          try {
            const resp = await fetch(url);
            const bytes = await resp.arrayBuffer();
            renderer.uploadModel(await db.addModel(url, transfer(bytes, [bytes]), 'auto-load'));
          } catch (e) {
            consoleActions.log('error', `auto-load ${url}: ${e}`);
          }
        }
        viewerActions.bumpModelsVersion();
      }

      // plain click (no drag, no modifier) -> pick the item under the cursor
      let downAt = { x: 0, y: 0 };
      let heldDigit = 0; // 1-9 while held (digit+click level select)
      canvas.addEventListener('pointerdown', (e) => {
        downAt = { x: e.clientX, y: e.clientY };
      });
      canvas.addEventListener('click', (e) => {
        if (e.altKey) {
          return; // alt+click re-pivots the camera
        }
        if (renderer.camera.spaceHeld) {
          return; // space+click flies the camera
        }
        if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) {
          return;
        }
        // label reposition armed: consume the click, move that label's anchor
        const repositionId = labelsState.get().repositionId;
        if (repositionId != null) {
          void renderer.probeWorldAsync(e.offsetX, e.offsetY).then((pt) => {
            if (!pt) {
              labelsState.set({ repositionId: null });
              return;
            }
            // a dragged label keeps its box in place — only the anchor point
            // (leader-line end) moves to the new click
            const l = labelsState.get().items.find((x) => x.id === repositionId);
            let offset: [number, number] | undefined;
            if (l && (l.offset[0] !== 0 || l.offset[1] !== 0)) {
              const rect = host.getBoundingClientRect();
              const a = projectToScreen(renderer.viewProjMatrix, rect.width, rect.height, l.anchor);
              const b = projectToScreen(renderer.viewProjMatrix, rect.width, rect.height, pt);
              if (a && b) {
                offset = [l.offset[0] + a[0] - b[0], l.offset[1] + a[1] - b[1]];
              }
            }
            labelsActions.moveAnchor(repositionId, pt, offset);
          });
          return;
        }
        // label placement armed: consume the click, drop the label there
        if (labelsState.get().placing) {
          void renderer.probeWorldAsync(e.offsetX, e.offsetY).then((pt) => {
            if (pt) {
              labelsActions.placeAt(pt);
            } else {
              labelsState.set({ placing: false });
            }
          });
          return;
        }
        // measurement tool active: consume the click, place a point at the
        // probed surface (auto-finishes Line/Diameter). No item selection.
        if (measurementsState.get().activeKind) {
          measurementsActions.setPerp(e.shiftKey);
          void renderer.probeMeasureAsync(e.offsetX, e.offsetY, measureSnap()).then((p) => {
            const hit = toHit(p);
            if (hit) {
              measurementsActions.addPoint(hit);
            }
          });
          return;
        }
        // armed "move to click": consume the click, move the selection so its
        // bounds bottom lands on the clicked point (no selection change)
        if (ribbonSelectionTransformState.get().moveToClickArmed) {
          void renderer.probeWorldAsync(e.offsetX, e.offsetY).then((pt) => {
            if (pt) {
              ribbonSelectionTransformActions.moveSelectionBottomTo(pt);
            } else {
              ribbonSelectionTransformState.set({ moveToClickArmed: false });
            }
          });
          return;
        }
        // pivot placement + "item pivot" helper: consume the click and move
        // the pivot to the clicked item's center — the selection stays put
        // (a selection change would reset the pivot session)
        const trs = ribbonSelectionTransformState.get();
        if (trs.pivotSetting && trs.pivotFromItem) {
          void renderer.pickItem(e.offsetX, e.offsetY).then(async (id) => {
            const hit = id !== null ? renderer.itemFromGlobalId(id) : null;
            if (!hit) {
              return;
            }
            const c = await db.itemCenter(hit.model, hit.item);
            if (c) {
              ribbonSelectionTransformActions.setPivotFromItem(c);
            }
          });
          return;
        }
        renderer.probeWorld(e.offsetX, e.offsetY); // remember the click point
        const additive = e.ctrlKey; // ctrl+click toggles into the selection
        const level = heldDigit; // digit 1-9 held → select the ancestor at that level
        // shift inverts the pick-opacity band (select faint / through glass)
        void renderer.pickItem(e.offsetX, e.offsetY, e.shiftKey).then((id) => {
          if (level > 0) {
            const hit = id !== null ? renderer.itemFromGlobalId(id) : null;
            if (hit) {
              void viewerActions.selectAtLevel(hit.model, hit.item, level);
            }
            return;
          }
          void viewerActions.selectFromPick(id, additive);
        });
      });

      // Double-click finishes an open-ended measurement (Path / Area).
      canvas.addEventListener('dblclick', (e) => {
        if (!measurementsState.get().activeKind) {
          return;
        }
        e.preventDefault();
        measurementsActions.finish();
      });

      // Live rubber-band: probe the surface under the cursor while a tool is
      // active (one probe in flight at a time). Cleared when off-surface.
      let hoverBusy = false;
      canvas.addEventListener('pointermove', (e) => {
        if (!measurementsState.get().activeKind) {
          return;
        }
        measurementsActions.setPerp(e.shiftKey);
        if (hoverBusy) {
          return;
        }
        hoverBusy = true;
        void renderer.probeMeasureAsync(e.offsetX, e.offsetY, measureSnap()).then((p) => {
          hoverBusy = false;
          measurementsActions.setHover(toHit(p));
        });
      });

      // Hover outline: throttled item pick under the cursor (one in flight,
      // ~30 Hz). Only when enabled, no buttons held, and no measure tool —
      // the converged renderer serves these via the cheap hold path.
      let outlineHoverBusy = false;
      let outlineHoverLast = 0;
      canvas.addEventListener('pointermove', (e) => {
        if (!viewerState.get().outlineHover) {
          return;
        }
        if (e.buttons !== 0 || measurementsState.get().activeKind) {
          return;
        }
        const now = performance.now();
        if (outlineHoverBusy || now - outlineHoverLast < 33) {
          return;
        }
        outlineHoverBusy = true;
        outlineHoverLast = now;
        void renderer.pickItem(e.offsetX, e.offsetY).then((id) => {
          outlineHoverBusy = false;
          renderer.setHoverItem(id);
        });
      });
      canvas.addEventListener('pointerleave', () => renderer.setHoverItem(null));

      // Enter finishes, Escape cancels, Backspace removes the last point — but
      // only while placing points, and we stop the event so the global ESC
      // (clear selection) / other hotkeys don't also fire. Capture phase beats
      // the window-level hotkey engine.
      const measureShift = (e: KeyboardEvent) => {
        if (measurementsState.get().activeKind) {
          measurementsActions.setPerp(e.shiftKey);
        }
      };
      window.addEventListener('keydown', measureShift);
      window.addEventListener('keyup', measureShift);

      const measureKeys = (e: KeyboardEvent) => {
        const ms = measurementsState.get();
        if (!ms.activeKind || ms.inProgress.length === 0) {
          return;
        }
        if (e.key === 'Enter') {
          measurementsActions.finish();
        } else if (e.key === 'Escape') {
          measurementsActions.cancel();
        } else if (e.key === 'Backspace') {
          measurementsActions.undoPoint();
        } else {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      window.addEventListener('keydown', measureKeys, true);

      // held digit 1-9 + click → select the picked item's ancestor at that
      // hierarchy level (1 = directly under the model root; deeper than the
      // item's path clamps to its leaf entry)
      const digitDown = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          return;
        }
        if (e.key >= '1' && e.key <= '9') {
          heldDigit = Number(e.key);
        }
      };
      const digitUp = (e: KeyboardEvent) => {
        if (e.key === String(heldDigit)) {
          heldDigit = 0;
        }
      };
      const digitBlur = () => {
        heldDigit = 0;
      };
      window.addEventListener('keydown', digitDown);
      window.addEventListener('keyup', digitUp);
      window.addEventListener('blur', digitBlur);

      removeMeasureKeys = () => {
        window.removeEventListener('keydown', measureKeys, true);
        window.removeEventListener('keydown', measureShift);
        window.removeEventListener('keyup', measureShift);
        window.removeEventListener('keydown', digitDown);
        window.removeEventListener('keyup', digitUp);
        window.removeEventListener('blur', digitBlur);
      };

      let lastFrameT = 0;
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        if (host.clientWidth === 0 || host.clientHeight === 0) {
          return; // hidden tab
        }
        // FPS limiter: fixed-step pacing with drift snap (Settings → Rendering)
        const minDt = 1000 / viewerState.get().fpsLimit;
        if (now - lastFrameT < minDt - 0.5) {
          return;
        }
        lastFrameT = now - lastFrameT > minDt * 2 ? now : lastFrameT + minDt;
        if (optionsDirty) {
          optionsDirty = false;
          applyOptions();
        }
        const cubeQ = cameraQuat(renderer.camera.forward());
        renderer.setViewCube(gizmo ? gizmo.getRect() : null, cubeHoverId(), cubeQ);
        renderer.frame(canvas);
        residency.tick(renderer, now); // VRAM budget (no-op while disabled)
        gizmo?.update(cubeQ);
        clipGizmo?.update();
        measureOverlay?.update();
        labelOverlay?.update();
        residencyBoxes?.update();

        const st = viewerState.get();
        setError(renderer.gpuError ? `GPU ERROR: ${renderer.gpuError}` : '');
        // the same row list as Settings → Stats, minus the rows unticked there
        const text = st.showStats ? formatOverlay(collectStats(renderer), st.statsHidden) : '';
        if (hud.textContent !== text) {
          hud.textContent = text;
        }
        const backdrop = text && st.statsBackdrop ? 'rgba(8,10,14,0.72)' : '';
        if (hud.style.background !== backdrop) {
          hud.style.background = backdrop;
          hud.style.padding = backdrop ? '4px 6px' : '';
          hud.style.borderRadius = backdrop ? '3px' : '';
        }

        // VRAM-budget activity chip: working / settled / waiting-for-idle
        let vText = '';
        let vColor = '#adb5bd';
        if (st.vramActivityHud) {
          const act = residency.activity();
          if (vramBudgetMb(st) === 0) {
            // budget off: only surface the restore-to-full pass while it runs
            if (act.inFlight > 0) {
              vText = '⟳ restoring full detail';
              vColor = '#4dabf7';
            }
          } else {
            const pct = Math.round(((renderer.vramBuffers + renderer.vramTextures) / 1048576 / vramBudgetMb(st)) * 100);
            if (act.inFlight > 0) {
              vText = `⟳ optimizing — vram ${pct}%`;
              vColor = '#4dabf7';
            } else if (act.settled) {
              vText = `✓ vram ${pct}%`;
              vColor = '#69db7c';
            } else {
              vText = `· vram ${pct}%`;
            }
          }
        }
        if (vramHud.textContent !== vText) {
          vramHud.textContent = vText;
          vramHud.style.display = vText ? 'block' : 'none';
        }
        if (vramHud.style.color !== vColor) {
          vramHud.style.color = vColor;
        }
      };
      tick(performance.now());
    };
    void boot();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      registerRenderer(null);
      gizmo?.dispose();
      clipGizmo?.dispose();
      measureOverlay?.dispose();
      labelOverlay?.dispose();
      residencyBoxes?.dispose();
      removeMeasureKeys?.();
      for (const off of unsubOptions) {
        off();
      }
      hostResize.disconnect();
      renderer.dispose();
      canvas.remove();
      hudWrap.remove();
    };
  },
};
