import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type PopoverPos = Readonly<{ left: number; top: number; width: number; up: boolean }>;

export type PopoverAnchor = Readonly<{
  open: boolean;
  setOpen: (o: boolean | ((o: boolean) => boolean)) => void;
  /** Trigger-anchored placement: `top` is the popover's top edge (or, with
   *  `up`, the trigger's top edge to place the popover above). */
  pos: PopoverPos;
  rootRef: RefObject<HTMLDivElement | null>;
  popRef: RefObject<HTMLDivElement | null>;
}>;

/**
 * Shared open/anchor state for body-portaled popovers (Select, DatePicker,
 * TimePicker): closes on outside pointerdown, anchors to the trigger while
 * anything scrolls or resizes, and flips upward when the estimated popover
 * height does not fit below and there is more room above.
 */
export function usePopoverAnchor(estimateHeight: number): PopoverAnchor {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos>({ left: 0, top: 0, width: 0, up: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && !rootRef.current?.contains(t) && !popRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) {
        return;
      }
      const up = r.bottom + estimateHeight > window.innerHeight && r.top > window.innerHeight - r.bottom;
      setPos({ left: r.left, width: r.width, top: up ? r.top : r.bottom, up });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open, estimateHeight]);

  return { open, setOpen, pos, rootRef, popRef };
}
