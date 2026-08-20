import { IconLoader2 } from '@tabler/icons-react';
import { Modal, TitleBar } from './Modal';

export interface LoadingDialogCoreProps {
  title: string;
  label: string;
  /** 0..1 renders a determinate progress bar; null/undefined hides it. */
  progress?: number | null;
  z?: number;
}

/** Pure blocking loading overlay — props only, no store coupling. */
export function LoadingDialogCore({ title, label, progress, z = 2020 }: LoadingDialogCoreProps) {
  return (
    <Modal z={z}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-64 border border-slate-600 bg-slate-900 shadow-black/50 shadow-xl"
      >
        <TitleBar icon={<IconLoader2 size={16} className="shrink-0 animate-spin text-blue-400" />}>{title}</TitleBar>
        <div className="flex flex-col gap-2 px-3 py-5">
          <span className="whitespace-pre-line text-xs">{label}</span>
          {progress != null && (
            <div role="progressbar" aria-valuenow={Math.round(progress * 100)} className="h-1.5 w-full bg-slate-800">
              <div
                className="h-full bg-blue-500 transition-[width] duration-150"
                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
