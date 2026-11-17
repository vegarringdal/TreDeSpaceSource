import { type MouseEvent as ReactMouseEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { onMenuRequest } from './menuRequests';

type Anchor = { x: number; y: number };

/** A button that opens a Menu under itself — on a click, or with `menuId`
 *  also on its hotkey (requestMenu): wrap the button in an element with
 *  `ref={menu.wrap}` so the menu knows where it is. */
export function useMenuAnchor(menuId?: string): {
  anchor: Anchor | null;
  open: (e: ReactMouseEvent) => void;
  close: () => void;
  wrap: RefObject<HTMLSpanElement | null>;
} {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const wrap = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!menuId) {
      return;
    }
    return onMenuRequest(menuId, () => {
      const r = wrap.current?.getBoundingClientRect();
      if (r) {
        setAnchor({ x: r.left, y: r.bottom + 2 });
      }
    });
  }, [menuId]);

  return {
    anchor,
    open: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setAnchor({ x: r.left, y: r.bottom + 2 });
    },
    close: () => setAnchor(null),
    wrap,
  };
}
