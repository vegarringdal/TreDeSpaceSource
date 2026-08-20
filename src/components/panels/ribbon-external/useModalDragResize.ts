import { type PointerEvent as ReactPointerEvent, type RefObject, useRef, useState } from 'react';

const MIN_W = 256;
const MIN_H = 160;

/** Move/resize state for an external modal box. Both drags use pointer
 *  CAPTURE so they survive crossing the hosted iframe — a native CSS resize
 *  grabber sits under the iframe and gets swallowed. `pos` stays null
 *  (overlay-centered) until the box is first dragged or resized. */
export function useModalDragResize(initial: { width: string; height: string }): {
  pos: { x: number; y: number } | null;
  size: { w: string; h: string };
  boxRef: RefObject<HTMLDivElement | null>;
  handleBarDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleBarMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleResizeDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleResizeMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  clearDrag: () => void;
} {
  // null pos = centered by the overlay's flex; set once dragged or resized
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: string; h: string }>({ w: initial.width, h: initial.height });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const rez = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const handleBarDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box || (e.target as HTMLElement).closest('button')) {
      return;
    }
    const r = box.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleBarMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) {
      return;
    }
    const r = box.getBoundingClientRect();
    setPos({
      x: Math.min(Math.max(e.clientX - d.dx, 8 - r.width), window.innerWidth - 40),
      y: Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - 30),
    });
  };

  const handleResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const r = box.getBoundingClientRect();
    // pin the top-left so resizing grows down/right instead of re-centering
    if (!pos) {
      setPos({ x: r.left, y: r.top });
    }
    rez.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const z = rez.current;
    if (!z) {
      return;
    }
    setSize({
      w: `${Math.max(MIN_W, z.w + e.clientX - z.x)}px`,
      h: `${Math.max(MIN_H, z.h + e.clientY - z.y)}px`,
    });
  };
  const clearDrag = () => {
    drag.current = null;
    rez.current = null;
  };

  return { pos, size, boxRef, handleBarDown, handleBarMove, handleResizeDown, handleResizeMove, clearDrag };
}
