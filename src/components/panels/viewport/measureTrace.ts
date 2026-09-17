// Measure-probe trace — Settings → Stats → "Verbose trace", read in the
// Console panel. One line when a probe is issued (the tap or crosshair
// position in every coordinate space involved) and one when it answers (the
// point and the CSS pixel the overlay will draw it at), around the renderer's
// own lines for the depth read and the raycasts. Exists so a device that
// cannot open DevTools — the tablet — can still show where a measurement
// goes wrong.
import { projectToScreen } from '../../../lib/math/project';
import type { Renderer } from '../../../lib/render/renderer';
import type { MeasureHit } from '../../../state/viewer/measurements.state';
import { viewerState } from '../../../state/viewer/viewer.state';
import { consoleActions } from '../console/console.actions';

export interface MeasureTraceDeps {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer;
}

const r1 = (v: number): string => v.toFixed(1);
const r3 = (v: number): string => v.toFixed(3);
const fmtRect = (r: DOMRect): string => `(${r1(r.left)},${r1(r.top)} ${r1(r.width)}x${r1(r.height)})`;

/**
 * Log a probe's inputs now and return the function that logs its answer, or
 * null while the trace is off. `extra` carries event facts only the caller
 * has (client point, event target, pointer type).
 */
export function traceMeasureProbe(
  deps: MeasureTraceDeps,
  label: string,
  cssX: number,
  cssY: number,
  extra = '',
): ((hit: MeasureHit | null) => void) | null {
  if (!viewerState.get().trace) {
    return null;
  }
  const { host, canvas, renderer } = deps;
  const vv = window.visualViewport;
  consoleActions.log(
    'info',
    `measure ${label}: css=(${r1(cssX)},${r1(cssY)}) ${extra} canvasRect=${fmtRect(canvas.getBoundingClientRect())} ` +
      `hostRect=${fmtRect(host.getBoundingClientRect())} canvas=${canvas.width}x${canvas.height} ` +
      `css=${canvas.clientWidth}x${canvas.clientHeight} devicePixelRatio=${window.devicePixelRatio} ` +
      `visualViewport=${vv ? `${vv.scale} @(${r1(vv.offsetLeft)},${r1(vv.offsetTop)})` : 'n/a'}`,
  );

  return (hit) => {
    if (!hit) {
      consoleActions.log('info', `measure ${label}: no hit`);
      return;
    }
    // where MeasureOverlay will draw it: the host rect and the current view
    const r = host.getBoundingClientRect();
    const at = projectToScreen(renderer.viewProjMatrix, r.width, r.height, hit.point);
    const drawn = at
      ? `(${r1(at[0])},${r1(at[1])}) Δ${r1(Math.hypot(at[0] - cssX, at[1] - cssY))}px from input`
      : 'behind camera';
    consoleActions.log(
      'info',
      `measure ${label}: ${hit.kind} point=(${r3(hit.point[0])}, ${r3(hit.point[1])}, ${r3(hit.point[2])}) drawAt=${drawn}`,
    );
  };
}
