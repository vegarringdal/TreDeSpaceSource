import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { MenuEntryButton } from './MenuEntryButton';
import { isSeparator, type MenuEntry } from './menuTypes';

export type { MenuEntry, MenuItem, MenuSeparator } from './menuTypes';

export interface MenuProps {
  /** Viewport coordinates of the press that opened it; null renders nothing. */
  anchor: Readonly<{ x: number; y: number }> | null;
  /** Entries in order; falsy entries are skipped, `{ separator: true }` draws a rule. */
  items: readonly MenuEntry[];
  /** An outside press, Escape and a pick all call this — clear `anchor` here. */
  onClose: () => void;
  /** Width floor in px (default 160) — keeps a short menu from looking cramped. */
  minWidth?: number;
  /** Entry id to focus when the menu opens (say the current choice) — for a
   *  menu opened from the keyboard. Escape or a pick then hands focus back to
   *  where it was. */
  focusId?: string;
  className?: string;
}

const VIEWPORT_MARGIN = 4;
const ENTRY_SELECTOR = 'button[role="menuitem"]:not(:disabled)';

/** Moves focus to the next (+1) or previous (-1) enabled entry, wrapping. */
function stepFocus(menu: HTMLElement, step: 1 | -1): void {
  const entries = [...menu.querySelectorAll<HTMLElement>(ENTRY_SELECTOR)];
  const focused = document.activeElement;
  if (!entries.length) {
    return;
  }
  const at = focused instanceof HTMLElement ? entries.indexOf(focused) : -1;
  const next = at < 0 ? (step > 0 ? 0 : entries.length - 1) : (at + step + entries.length) % entries.length;
  entries[next].focus();
}

/**
 * A right-click menu, portaled to the body so panel scroll clipping can never
 * cut it off. It opens at the press position and is then measured and nudged
 * back inside the viewport — no hard-coded size guesses. Closes on any outside
 * press, on Escape, and after a pick. While focus is inside, the arrow keys
 * move between entries.
 */
export function Menu({ anchor, items, onClose, minWidth = 160, focusId, className = '' }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
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

  // focus the asked-for entry once per opening, remembering where focus was
  const isOpen = anchor !== null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!isOpen || !el || focusId === undefined) {
      return;
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = [...el.querySelectorAll<HTMLButtonElement>(ENTRY_SELECTOR)].find((b) => b.dataset.menuId === focusId);
    entry?.focus();
  }, [isOpen, focusId]);

  /** Closing from inside (Escape, a pick) hands focus back; an outside press
   *  leaves it where the press put it. */
  const closeFromInside = useCallback(() => {
    if (ref.current?.contains(document.activeElement)) {
      returnFocus.current?.focus();
    }
    returnFocus.current = null;
    onClose();
  }, [onClose]);

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
        closeFromInside();
        return;
      }
      const el = ref.current;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el?.contains(document.activeElement)) {
        e.preventDefault();
        stepFocus(el, e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    // capture phase, like Modal: an app hotkey bound to Escape claims the key
    // (stopPropagation) on the window's capture phase, and a bubble listener
    // would then never hear it
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose, closeFromInside]);

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
        return <MenuEntryButton key={entry.id} item={entry} onClose={closeFromInside} />;
      })}
    </div>,
    document.body,
  );
}
