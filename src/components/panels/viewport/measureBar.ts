// In-progress measurement bar — the on-canvas Finish / Undo / Cancel affordance.
//
// Finishing an open-ended measurement (Path, Area) used to be Enter or a
// double-click, and undo/cancel were Backspace/Escape: all unreachable on a
// tablet, where a double-tap is unreliable and there is no keyboard. This bar
// appears over the viewport only while points are down, with touch-sized
// targets, and mirrors those three keys for everyone. A fixed-count
// measurement (Line, Diameter, …) with all its points placed shows OK instead
// of Finish: it is kept on OK, Enter, or the next placed point, and until then
// its last point can be undone — auto-finishing on the last point left no
// way to do that.
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { awaitsOk, KIND_LABEL, measurementsState, minPoints } from '../../../state/viewer/measurements.state';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Touch target height (the platform guideline minimum). */
const BUTTON_PX = 44;

const ICON_CHECK = '<path d="M5 12l5 5L20 7"/>';
const ICON_UNDO = '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a4 4 0 0 1 0 8h-1"/>';
const ICON_CANCEL = '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>';

const BAR_CSS =
  'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:7;' +
  'display:none;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;' +
  'background:rgba(15,23,42,0.88);border:1px solid rgba(148,163,184,0.3);' +
  'backdrop-filter:blur(3px);box-shadow:0 4px 14px rgba(0,0,0,0.45);' +
  'font:13px system-ui,sans-serif;color:#dfe3ea;touch-action:manipulation;' +
  'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;max-width:calc(100% - 16px);';

const BUTTON_CSS =
  `display:flex;align-items:center;gap:6px;min-height:${BUTTON_PX}px;padding:0 14px;` +
  'border-radius:5px;border:1px solid rgba(148,163,184,0.3);background:rgba(51,65,85,0.85);' +
  'color:#e8ecf3;font:13px system-ui,sans-serif;cursor:pointer;white-space:nowrap;';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function icon(paths: string): string {
  return (
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
  );
}

function makeButton(paths: string, label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.cssText = BUTTON_CSS;
  b.title = title;
  b.innerHTML = `${icon(paths)}<span>${label}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

function setEnabled(b: HTMLButtonElement, on: boolean) {
  b.disabled = !on;
  b.style.opacity = on ? '1' : '0.4';
  b.style.cursor = on ? 'pointer' : 'default';
}

// -----------------------------------------------------------------------------
// controller
// -----------------------------------------------------------------------------

/**
 * Mount the in-progress bar on the viewport host. It shows itself whenever the
 * active tool has at least one point placed and hides again on finish/cancel.
 */
export function attachMeasureBar(host: HTMLElement): { dispose(): void } {
  const bar = document.createElement('div');
  bar.style.cssText = BAR_CSS;

  const status = document.createElement('span');
  status.style.cssText = 'padding:0 6px 0 4px;color:#adb5bd;white-space:nowrap;';

  const finish = makeButton(ICON_CHECK, 'Finish', 'Finish this measurement (Enter, or double-click)', () =>
    measurementsActions.finish(),
  );
  const finishLabel = finish.querySelector('span');
  const undo = makeButton(ICON_UNDO, 'Undo', 'Remove the last point (Backspace)', () =>
    measurementsActions.undoPoint(),
  );
  const cancel = makeButton(ICON_CANCEL, 'Cancel', 'Discard this measurement (Esc)', () =>
    measurementsActions.cancel(),
  );

  bar.append(status, finish, undo, cancel);
  host.appendChild(bar);

  let lastKey = '';

  const render = () => {
    const s = measurementsState.get();
    const n = s.inProgress.length;
    const show = !!s.activeKind && n > 0;
    const key = `${show ? s.activeKind : ''}:${n}`;
    if (key === lastKey) {
      return;
    }
    lastKey = key;
    bar.style.display = show ? 'flex' : 'none';
    if (!show || !s.activeKind) {
      return;
    }
    status.textContent = `${KIND_LABEL[s.activeKind]} · ${n} ${n === 1 ? 'point' : 'points'}`;
    const ok = awaitsOk(s.activeKind, n);
    if (finishLabel) {
      finishLabel.textContent = ok ? 'OK' : 'Finish';
    }
    finish.title = ok
      ? 'Keep this measurement (Enter) — placing the next point keeps it too'
      : 'Finish this measurement (Enter, or double-click)';
    setEnabled(finish, n >= minPoints(s.activeKind));
  };

  render();
  const unsub = measurementsState.subscribe(render);

  return {
    dispose() {
      unsub();
      bar.remove();
    },
  };
}
