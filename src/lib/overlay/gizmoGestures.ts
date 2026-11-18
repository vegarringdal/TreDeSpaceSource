// The navigation gizmo's style switch: a right-click, or a press held still
// (mouse or finger), on the gizmo toggles cube ⇄ axis balls. The hold uses
// the same timing as measure aim (measureAim.ts HOLD_MS / SLOP_PX), so a
// long-press feels the same everywhere in the viewer.

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const HOLD_MS = 450;
/** Travel that turns a hold into a drag: a finger wobbles more than a mouse. */
const TOUCH_SLOP_PX = 10;
const MOUSE_SLOP_PX = 4;
/** A touch long-press can also fire the browser's contextmenu; one toggle per gesture. */
const TOGGLE_GUARD_MS = 700;
const HAPTIC_MS = 10;

// -----------------------------------------------------------------------------
// gesture
// -----------------------------------------------------------------------------

/**
 * Listen on `el` (the gizmo stage) for the switch gestures and call
 * `onToggle`. The click that follows a long-press is swallowed in the
 * capture phase, so the face or ball under the finger is not also picked.
 * Returns the detach function.
 */
export function attachStyleToggle(el: HTMLElement, onToggle: () => void): () => void {
  let timer = 0;
  let start: { x: number; y: number; slop: number } | null = null;
  let lastToggleAt = Number.NEGATIVE_INFINITY;
  let isSwallowingClick = false;

  const toggle = () => {
    const now = performance.now();
    if (now - lastToggleAt < TOGGLE_GUARD_MS) {
      return;
    }
    lastToggleAt = now;
    try {
      navigator.vibrate?.(HAPTIC_MS);
    } catch {
      // no haptics on this device
    }
    onToggle();
  };
  const cancelHold = () => {
    window.clearTimeout(timer);
    start = null;
  };

  const handleDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    isSwallowingClick = false;
    start = { x: e.clientX, y: e.clientY, slop: e.pointerType === 'touch' ? TOUCH_SLOP_PX : MOUSE_SLOP_PX };
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      start = null;
      isSwallowingClick = true;
      toggle();
    }, HOLD_MS);
  };
  const handleMove = (e: PointerEvent) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > start.slop) {
      cancelHold();
    }
  };
  const handleClick = (e: MouseEvent) => {
    if (isSwallowingClick) {
      isSwallowingClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    cancelHold();
    toggle();
  };

  el.addEventListener('pointerdown', handleDown);
  el.addEventListener('pointermove', handleMove);
  el.addEventListener('pointerup', cancelHold);
  el.addEventListener('pointercancel', cancelHold);
  el.addEventListener('click', handleClick, true);
  el.addEventListener('contextmenu', handleContextMenu);
  return () => {
    cancelHold();
    el.removeEventListener('pointerdown', handleDown);
    el.removeEventListener('pointermove', handleMove);
    el.removeEventListener('pointerup', cancelHold);
    el.removeEventListener('pointercancel', cancelHold);
    el.removeEventListener('click', handleClick, true);
    el.removeEventListener('contextmenu', handleContextMenu);
  };
}
