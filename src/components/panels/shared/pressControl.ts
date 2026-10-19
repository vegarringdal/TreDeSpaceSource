// A hotkey that presses the on-screen control carrying it — a stepper's − or
// +, a segment, a checkbox (the control's `data-shortcut`, the same id its
// tooltip shows). The hotkey then does exactly what the control does, with
// its steps, limits and undo, and only while the control is on screen.

import { type AnimationPanelId, isAnimationPanelOpen } from '../animation/animationPanels';

/** The control with hotkey `id` inside panel `panel`, if it is shown. */
function controlIn(panel: AnimationPanelId, id: string): HTMLElement | null {
  if (!isAnimationPanelOpen(panel)) {
    return null;
  }
  const root = document.querySelector(`.dock-panel[data-panel="${panel}"]`);
  return root?.querySelector<HTMLElement>(`[data-shortcut="${CSS.escape(id)}"]`) ?? null;
}

/** Is the control with hotkey `id` on screen in `panel` (and usable)? */
export function hasControl(panel: AnimationPanelId, id: string): boolean {
  const el = controlIn(panel, id);
  return el !== null && !el.matches(':disabled');
}

/** Press the control with hotkey `id` in `panel`, as a click does. */
export function pressControl(panel: AnimationPanelId, id: string): void {
  const el = controlIn(panel, id);
  if (el && !el.matches(':disabled')) {
    el.click();
  }
}
