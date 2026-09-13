import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { MenuEntryButton } from './MenuEntryButton';
import { isSeparator, type MenuEntry } from './menuTypes';

export type { MenuEntry, MenuItem, MenuSeparator } from './menuTypes';

export interface MenuProps {
  /** Viewport coordinates of the press that opened it; null renders nothing. */
  anchor: Readonly<{ x: number; y: number }> | null;
  items: readonly MenuEntry[];
  onClose: () => void;
  /** Width floor in px (default 160) — keeps a short menu from looking cramped. */
  minWidth?: number;
  className?: string;
}

const VIEWPORT_MARGIN = 4;

/**
 * A right-click menu, portaled to the body so panel scroll clipping can never
 * cut it off. It opens at the press position and is then measured and nudged
 * back inside the viewport — no hard-coded size guesses. Closes on any outside
 * press, on Escape, and after a pick.
 */
export function Menu({ anchor, items, onClose, minWidth = 160, className = '' }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) {
      setPos(anchor);
      return;
    }
    setPos({
      x: Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, window.innerWidth - el.offsetWidth - VIEWPORT_MARGIN)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, window.innerHeight - el.offsetHeight - VIEWPORT_MARGIN)),
    });
  }, [anchor]);

  useEffect(() => {
    if (!anchor) {
      return;
    }
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  if (!anchor) {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={cn(
        'fixed z-[3000] flex flex-col border border-slate-700 bg-slate-900 py-1 text-xs shadow-black/50 shadow-lg',
        className,
      )}
      style={{ left: pos?.x ?? anchor.x, top: pos?.y ?? anchor.y, minWidth }}
    >
      {items.map((entry, i) => {
        if (entry == null || entry === false) {
          return null;
        }
        if (isSeparator(entry)) {
          // biome-ignore lint/suspicious/noArrayIndexKey: a rule has no identity beyond its position
          return <div key={`sep:${i}`} className="my-1 border-slate-700 border-t" />;
        }
        return <MenuEntryButton key={entry.id} item={entry} onClose={onClose} />;
      })}
    </div>,
    document.body,
  );
}
