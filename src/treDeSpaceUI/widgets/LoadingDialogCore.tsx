import { IconLoader2 } from '@tabler/icons-react';
import { DialogFrame } from './DialogFrame';
import { ProgressBar } from './Spinner';

export interface LoadingDialogCoreProps {
  title: string;
  label: string;
  /** 0..1 renders a determinate progress bar; null/undefined hides it. */
  progress?: number | null;
  z?: number;
}

/** Pure blocking loading overlay — props only, no store coupling. It has no
 *  close path on purpose: the work owns the dialog's lifetime. */
export function LoadingDialogCore({ title, label, progress, z = 2020 }: LoadingDialogCoreProps) {
  return (
    <DialogFrame
      z={z}
      width={256}
      icon={<IconLoader2 size={16} className="shrink-0 animate-spin text-blue-400" />}
      title={title}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-5"
    >
      <span className="whitespace-pre-line text-xs">{label}</span>
      {progress != null && <ProgressBar value={progress} />}
    </DialogFrame>
  );
}
