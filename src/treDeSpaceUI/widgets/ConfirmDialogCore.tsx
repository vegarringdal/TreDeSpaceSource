import { IconHelpCircle } from '@tabler/icons-react';
import { Modal, TitleBar } from './Modal';

export interface ConfirmDialogCoreProps {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  /** Called with true for OK, false for Cancel/Escape. */
  onResult: (ok: boolean) => void;
  z?: number;
}

/** Pure OK/Cancel dialog — props only, no store coupling. */
export function ConfirmDialogCore({
  title,
  message,
  okLabel,
  cancelLabel,
  onResult,
  z = 2000,
}: ConfirmDialogCoreProps) {
  return (
    <Modal z={z} onKeyDown={(e) => e.key === 'Escape' && onResult(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-80 border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl"
      >
        <TitleBar icon={<IconHelpCircle size={16} className="shrink-0 text-blue-400" />}>{title}</TitleBar>
        <div className="whitespace-pre-line px-3 py-4 text-xs leading-relaxed">{message}</div>
        <div className="flex justify-end gap-1.5 border-slate-800 border-t px-3 py-2">
          <button
            type="button"
            className="cursor-pointer border border-slate-600 bg-transparent px-4 py-1 text-slate-300 text-xs hover:bg-slate-800 hover:text-slate-200"
            onClick={() => onResult(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="cursor-pointer border border-blue-400 bg-blue-950 px-4 py-1 text-blue-100 text-xs hover:bg-blue-900"
            onClick={() => onResult(true)}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
