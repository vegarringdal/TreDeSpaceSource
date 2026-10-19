import { IconAlertTriangle } from '@tabler/icons-react';
import { Button } from './Button';
import { DialogFrame } from './DialogFrame';

export interface ErrorDialogCoreProps {
  /** Title-bar text. */
  title: string;
  /** What went wrong (newlines kept). */
  message: string;
  /** OK, Escape, the backdrop and the ✕ all call this. */
  onDismiss: () => void;
  /** Stacking layer (default 2010 — above a dialog that failed). */
  z?: number;
}

/** Pure error dialog — props only, no store coupling. */
export function ErrorDialogCore({ title, message, onDismiss, z = 2010 }: ErrorDialogCoreProps) {
  return (
    <DialogFrame
      role="alertdialog"
      z={z}
      icon={<IconAlertTriangle size={16} className="shrink-0 text-amber-400" />}
      title={title}
      onClose={onDismiss}
      footer={
        <Button className="px-4" onClick={onDismiss}>
          OK
        </Button>
      }
    >
      {message}
    </DialogFrame>
  );
}
