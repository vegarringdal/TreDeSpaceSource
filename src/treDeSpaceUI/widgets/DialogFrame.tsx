import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Modal, TitleBar } from './Modal';

export interface DialogFrameProps {
  /** Title-bar icon (locked to 16×16 by the caller's choice of icon). */
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  /** Footer buttons, right-aligned above the bottom rule. */
  footer?: ReactNode;
  /** CSS width — a number is px (default 320). */
  width?: number | string;
  /** CSS height — omit to hug the content. */
  height?: number | string;
  /** CSS max height (default '80vh'); the body scrolls inside it. */
  maxHeight?: number | string;
  /** Escape, the backdrop and the title-bar ✕ all call this. Without it the
   *  dialog cannot be dismissed by the user (a blocking progress overlay). */
  onClose?: () => void;
  /** `alertdialog` for a message that interrupts (default `dialog`). */
  role?: 'dialog' | 'alertdialog';
  z?: number;
  /** Replaces the default body padding — for a dialog that composes its own
   *  strips (a filter bar over a scrolling list). */
  bodyClassName?: string;
  className?: string;
}

/** The one dialog window: backdrop, bordered box, title bar with ✕, a body
 *  that scrolls within `maxHeight`, and a footer rule for the buttons. Every
 *  dialog in the app is this frame plus its content. */
export function DialogFrame({
  icon,
  title,
  children,
  footer,
  width = 320,
  height,
  maxHeight = '80vh',
  onClose,
  role = 'dialog',
  z = 2000,
  bodyClassName,
  className = '',
}: DialogFrameProps) {
  return (
    <Modal z={z} onClose={onClose}>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is dialog | alertdialog — both take aria-modal; the rule cannot read the union */}
      <div
        role={role}
        aria-modal="true"
        style={{ width, height, maxHeight }}
        className={cn('flex flex-col border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl', className)}
      >
        <TitleBar icon={icon} onClose={onClose}>
          {title}
        </TitleBar>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-y-auto',
            bodyClassName ?? 'px-3 py-4 text-xs leading-relaxed',
          )}
        >
          {children}
        </div>
        {footer != null && (
          <div className="flex shrink-0 justify-end gap-1.5 border-slate-800 border-t px-3 py-2">{footer}</div>
        )}
      </div>
    </Modal>
  );
}
