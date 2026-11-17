import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { TONE_ACCENT, TONE_BLOCK, type Tone } from '../tone';
import { toast } from './toast.actions';
import { type ToastItem, toastState } from './toast.state';

export interface ToasterProps {
  /** Stacking layer — above the modal layer by default, so a toast raised by a
   *  dialog's own action is still readable. */
  z?: number;
  className?: string;
}

const ICON: Readonly<Record<Tone, ReactNode>> = {
  neutral: <IconInfoCircle size={15} />,
  info: <IconInfoCircle size={15} />,
  success: <IconCircleCheck size={15} />,
  warning: <IconAlertTriangle size={15} />,
  danger: <IconAlertTriangle size={15} />,
};

const DEFAULT_Z = 2600;

function ToastRow({ item }: { item: ToastItem }) {
  return (
    <output
      className={cn(
        'pointer-events-auto flex w-72 items-start gap-2 border px-2.5 py-2 text-slate-200 text-xs shadow-black/50 shadow-lg backdrop-blur-sm',
        TONE_BLOCK[item.tone],
      )}
      onPointerEnter={() => toast.hold(item.id)}
      onPointerLeave={() => toast.resume(item.id, item.duration)}
    >
      <span className={cn('mt-px shrink-0', TONE_ACCENT[item.tone])}>{ICON[item.tone]}</span>
      <div className="min-w-0 flex-1 leading-relaxed">
        {item.title != null && <div className="font-semibold">{item.title}</div>}
        <div className="whitespace-pre-line break-words text-slate-300">{item.message}</div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="-mr-1 shrink-0 cursor-pointer text-slate-500 hover:text-slate-200"
        onClick={() => toast.dismiss(item.id)}
      >
        <IconX size={13} />
      </button>
    </output>
  );
}

/** The toast stack. Mount once at the app root; everything else calls
 *  {@link toast}. Bottom-right, newest at the bottom, hover to hold. */
export function Toaster({ z = DEFAULT_Z, className = '' }: ToasterProps) {
  const { items } = toastState.use();

  if (items.length === 0) {
    return null;
  }

  return createPortal(
    <div
      className={cn('pointer-events-none fixed right-3 bottom-3 flex flex-col items-end gap-1.5', className)}
      style={{ zIndex: z }}
    >
      {items.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </div>,
    document.body,
  );
}
