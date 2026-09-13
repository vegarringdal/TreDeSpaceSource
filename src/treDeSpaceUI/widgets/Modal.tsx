import { IconX } from '@tabler/icons-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface ModalProps {
  z: number;
  children: ReactNode;
  /** Escape and a backdrop press close the modal. Without it the shell is
   *  purely visual and the caller owns dismissal (a blocking progress overlay). */
  onClose?: () => void;
  /** Keep the backdrop inert and close on Escape only (default true closes on
   *  both) — for a dialog whose work would be lost by a stray click. */
  closeOnBackdrop?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

// Escape belongs to the TOP dialog only: a document listener would close a
// stack of them at once, and a React onKeyDown only fires while focus happens
// to be inside. Every open Modal with an onClose registers here in mount order
// and the last one wins.
const escapeStack: Array<() => void> = [];

function useEscapeToClose(onClose: (() => void) | undefined): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  const dismissable = onClose != null;

  useEffect(() => {
    if (!dismissable) {
      return;
    }
    const close = () => latest.current?.();
    escapeStack.push(close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeStack[escapeStack.length - 1] === close) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = escapeStack.indexOf(close);
      if (i !== -1) {
        escapeStack.splice(i, 1);
      }
    };
    // Only whether the modal is dismissable matters here; the callback itself
    // is read through the ref, so a fresh closure never re-binds the listener.
  }, [dismissable]);
}

/** Shared modal shell: dimmed backdrop + centred window at the given layer. */
export function Modal({ z, children, onClose, closeOnBackdrop = true, onKeyDown }: ModalProps) {
  useEscapeToClose(onClose);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 text-slate-200"
      style={{ zIndex: z }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (onClose && closeOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface TitleBarProps {
  icon: ReactNode;
  children: ReactNode;
  /** Renders a ✕ at the right end. */
  onClose?: () => void;
  className?: string;
}

/** A dialog's title strip: icon, title, optional close ✕. */
export function TitleBar({ icon, children, onClose, className = '' }: TitleBarProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 border-slate-800 border-b bg-slate-800 px-3 py-2 font-semibold text-xs',
        className,
      )}
    >
      {icon}
      {children}
      {onClose != null && (
        <button
          type="button"
          aria-label="Close"
          data-tooltip="Close"
          className="ml-auto shrink-0 cursor-pointer text-slate-400 hover:text-slate-200"
          onClick={onClose}
        >
          <IconX size={15} />
        </button>
      )}
    </div>
  );
}
