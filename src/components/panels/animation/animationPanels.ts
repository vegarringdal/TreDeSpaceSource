// Dock access for the animation tool (the panelRegistry opener pattern):
// useAppStartup registers the live manager once; actions, hotkeys and the
// floating play bar only call these. Ids match appPanels.ts.

export type AnimationPanelId =
  | 'animation'
  | 'animationTimeline'
  | 'overlayEditor'
  | 'overlayPreview'
  | 'multiColor'
  | 'ribbonAnimation';

interface AnimationDock {
  open: (id: AnimationPanelId) => void;
  isOpen: (id: AnimationPanelId) => boolean;
  subscribe: (fn: () => void) => () => void;
}

let dock: AnimationDock | null = null;
let unsubDock: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

/** Register (or clear) the live dock; listeners subscribed before it existed
 *  are carried over. */
export function registerAnimationDock(d: AnimationDock | null): void {
  unsubDock?.();
  dock = d;
  unsubDock = d ? d.subscribe(notify) : null;
  notify();
}

/** Open (or focus) one of the animation panels. */
export function openAnimationPanel(id: AnimationPanelId): void {
  dock?.open(id);
}

/** Is that panel open somewhere (docked or floating)? */
export function isAnimationPanelOpen(id: AnimationPanelId): boolean {
  return dock?.isOpen(id) ?? false;
}

/** Hear about any dock layout change. */
export function subscribeAnimationDock(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
