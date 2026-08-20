import { IconPencil } from '@tabler/icons-react';
import { Modal, TitleBar } from './Modal';

export interface PromptDialogCoreProps {
  title: string;
  message: string;
  value: string;
  okLabel: string;
  cancelLabel?: string;
  onChange: (value: string) => void;
  /** Called with true for OK/Enter, false for Cancel/Escape. */
  onResult: (ok: boolean) => void;
  z?: number;
}

/** Pure one-line text-input dialog — props only, no store coupling; the caller
 *  owns the controlled input value. */
export function PromptDialogCore({
  title,
  message,
  value,
  okLabel,
  cancelLabel = 'Cancel',
  onChange,
  onResult,
  z = 2000,
}: PromptDialogCoreProps) {
  return (
    <Modal z={z} onKeyDown={(e) => e.key === 'Escape' && onResult(false)}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-80 border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl"
      >
        <TitleBar icon={<IconPencil size={16} className="shrink-0 text-blue-400" />}>{title}</TitleBar>
        <div className="flex flex-col gap-2 px-3 py-4 text-xs leading-relaxed">
          <span>{message}</span>
          <input
            // biome-ignore lint/a11y/noAutofocus: single-field dialog — focus is the point
            autoFocus
            value={value}
            className="w-full border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 text-xs outline-none focus:border-blue-400"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onResult(true);
              }
            }}
          />
        </div>
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
