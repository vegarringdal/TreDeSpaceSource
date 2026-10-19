import { type RefObject, useEffect, useRef } from 'react';

/**
 * A wheel listener that may call `preventDefault()`. React's `onWheel` is
 * passive, so it can neither stop the panel scrolling under a field that
 * steps on the wheel nor stop Ctrl+wheel from zooming the whole page. The
 * handler is read fresh on every event; the element must mount with the
 * component (the ref is read once).
 */
export function useWheel(ref: RefObject<HTMLElement | null>, onWheel: (e: WheelEvent) => void): void {
  const latest = useRef(onWheel);
  latest.current = onWheel;
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const handle = (e: WheelEvent) => latest.current(e);
    el.addEventListener('wheel', handle, { passive: false });
    return () => el.removeEventListener('wheel', handle);
  }, [ref]);
}
