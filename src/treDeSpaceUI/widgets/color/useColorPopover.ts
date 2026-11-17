import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';

/** Popover plumbing shared with the trigger: close on outside pointer press,
 *  and place the fixed popover under (or above) the trigger, clamped to the
 *  viewport's right edge. */
export function useColorPopover(
  open: boolean,
  setOpen: (o: boolean) => void,
  rootRef: RefObject<HTMLDivElement | null>,
  popRef: RefObject<HTMLDivElement | null>,
): { left: number; top: number; up: boolean } {
  const [pos, setPos] = useState({ left: 0, top: 0, up: false });

  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, setOpen, rootRef, popRef]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) {
        return;
      }
      const up = r.bottom + 280 > window.innerHeight && r.top > window.innerHeight - r.bottom;
      // keep the popover on screen when the trigger sits near the right edge
      const POP_W = 208; // w-52
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
      setPos({ left, top: up ? r.top : r.bottom, up });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open, rootRef]);

  return pos;
}
