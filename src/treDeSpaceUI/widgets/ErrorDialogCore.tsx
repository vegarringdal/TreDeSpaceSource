import { IconAlertTriangle } from '@tabler/icons-react';
import { Modal, TitleBar } from './Modal';

export interface ErrorDialogCoreProps {
  title: string;
  message: string;
  onDismiss: () => void;
  z?: number;
}

/** Pure error dialog — props only, no store coupling. */
export function ErrorDialogCore({ title, message, onDismiss, z = 2010 }: ErrorDialogCoreProps) {
  return (
    <Modal z={z}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-80 border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl"
      >
        <TitleBar icon={<IconAlertTriangle size={16} className="shrink-0 text-amber-400" />}>{title}</TitleBar>
        <div className="px-3 py-4 text-xs leading-relaxed">{message}</div>
        <div className="flex justify-end border-slate-800 border-t px-3 py-2">
          <button
            type="button"
            className="cursor-pointer border border-slate-600 bg-slate-800 px-4 py-1 text-slate-200 text-xs hover:bg-slate-700"
            onClick={onDismiss}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
