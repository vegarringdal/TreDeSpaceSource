/** Does the Timeline panel have the keyboard focus? Its own keys (Ctrl+C /
 *  Ctrl+V for keys, Delete, Home / End) then win over app-wide shortcuts on
 *  the same combo. */
export function isTimelineFocused(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLElement && a.closest('.dock-panel[data-panel="animationTimeline"]') !== null;
}
