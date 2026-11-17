import { type PointerEvent as ReactPointerEvent, useState } from 'react';

/** A ribbon button that opens a Menu under itself: the anchor comes from the
 *  button's own rect on pointer-down (RibbonButton's click has no event). */
export function useRibbonMenu(): {
  anchor: { x: number; y: number } | null;
  openAt: (e: ReactPointerEvent) => void;
  close: () => void;
} {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return {
    anchor,
    openAt: (e) => {
      const el = e.currentTarget;
      if (el instanceof HTMLElement) {
        const r = el.getBoundingClientRect();
        setAnchor({ x: r.left, y: r.bottom + 2 });
      }
    },
    close: () => setAnchor(null),
  };
}
