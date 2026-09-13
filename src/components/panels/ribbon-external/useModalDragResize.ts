import { usePointerDrag } from '@treDeSpaceUI/lib/usePointerDrag';
import { type PointerEvent as ReactPointerEvent, type RefObject, useRef, useState } from 'react';

const MIN_W = 256;
const MIN_H = 160;
/** Keep this much of the box reachable when it is dragged off-screen. */
const EDGE_KEEP = 8;
const BAR_KEEP = 30;
const RIGHT_KEEP = 40;

/** Move/resize state for an external modal box. Both gestures run on
 *  usePointerDrag, which uses pointer CAPTURE — so they survive crossing the
 *  hosted iframe (a native CSS resize grabber sits under it and gets
 *  swallowed). `pos` stays null (overlay-centered) until the box is first
 *  dragged or resized. */
export function useModalDragResize(initial: { width: string; height: string }): {
  pos: { x: number; y: number } | null;
  size: { w: string; h: string };
  boxRef: RefObject<HTMLDivElement | null>;
  handleBarDown: (e: ReactPointerEvent<HTMLElement>) => void;
  handleResizeDown: (e: ReactPointerEvent<HTMLElement>) => void;
} {
  // null pos = centered by the overlay's flex; set once dragged or resized
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: string; h: string }>({ w: initial.width, h: initial.height });
  const boxRef = useRef<HTMLDivElement>(null);
  const grab = useRef({ dx: 0, dy: 0 });
  const from = useRef({ w: 0, h: 0 });

  const move = usePointerDrag({
    onMove: ({ x, y }) => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) {
        return;
      }
      setPos({
        x: Math.min(Math.max(x - grab.current.dx, EDGE_KEEP - r.width), window.innerWidth - RIGHT_KEEP),
        y: Math.min(Math.max(y - grab.current.dy, 0), window.innerHeight - BAR_KEEP),
      });
    },
  });

  const resize = usePointerDrag({
    onMove: ({ dx, dy }) => {
      setSize({
        w: `${Math.max(MIN_W, from.current.w + dx)}px`,
        h: `${Math.max(MIN_H, from.current.h + dy)}px`,
      });
    },
  });

  const handleBarDown = (e: ReactPointerEvent<HTMLElement>) => {
    const box = boxRef.current;
    if (!box || (e.target instanceof HTMLElement && e.target.closest('button'))) {
      return;
    }
    const r = box.getBoundingClientRect();
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    move.start(e);
  };

  const handleResizeDown = (e: ReactPointerEvent<HTMLElement>) => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const r = box.getBoundingClientRect();
    // pin the top-left so resizing grows down/right instead of re-centering
    if (!pos) {
      setPos({ x: r.left, y: r.top });
    }
    from.current = { w: r.width, h: r.height };
    resize.start(e);
  };

  return { pos, size, boxRef, handleBarDown, handleResizeDown };
}
