import { IconInfoCircle } from '@tabler/icons-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface InfoButtonProps {
  /** The explanation shown in the popover — the old InfoBox content. */
  children: ReactNode;
  /** Accessible label / hover tooltip for the trigger. */
  label?: string;
  className?: string;
}

/** A small info icon that reveals its note in a click-popover — the compact
 *  replacement for an always-on {@link InfoBox}. Sits in panel/section headers
 *  so the hint is one click away instead of taking permanent vertical space. */
export function InfoButton({ children, label = 'More info', className = '' }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 280, below: true, arrowLeft: 12 });

  // Anchor the popover to the icon and keep it anchored while things scroll/resize.
  // Reads the rendered height so it can flip above the icon when there's no room
  // below, and points the arrow back at the icon we clicked.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const GAP = 8;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!r || !pop) {
        return;
      }
      const width = Math.min(280, window.innerWidth - 16);
      const h = pop.offsetHeight;
      const roomBelow = window.innerHeight - r.bottom;
      const below = roomBelow >= h + GAP + 4 || roomBelow >= r.top;
      // right-align under the icon, clamped to the viewport
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      const top = below ? r.bottom + GAP : r.top - h - GAP;
      // arrow sits under the icon's centre, kept inside the bubble
      const arrowLeft = Math.min(Math.max(10, r.left + r.width / 2 - left - 4), width - 18);
      setPos({ left, top, width, below, arrowLeft });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        data-tooltip={label}
        className={cn(
          'flex shrink-0 items-center justify-center text-slate-400 hover:text-amber-400',
          open && 'text-amber-400',
          className,
        )}
        // don't let a header's own click (e.g. Collapsible toggle) also fire
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconInfoCircle size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            className="fixed z-[2000]"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            {/* arrow pointing back at the icon — a rotated square straddling the
                edge that faces it, coloured like the bubble */}
            <div
              className={cn(
                'absolute h-2 w-2 rotate-45 border-slate-700 bg-slate-900',
                pos.below ? 'border-t border-l' : 'border-r border-b',
              )}
              style={{ left: pos.arrowLeft, [pos.below ? 'top' : 'bottom']: -4 }}
            />
            <div className="max-h-[60vh] overflow-y-auto border border-slate-700 border-l-4 border-l-amber-500 bg-slate-900 px-2.5 py-2 text-[11px] text-slate-300 leading-relaxed shadow-black/50 shadow-lg">
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
