import { IconHelpCircle } from '@tabler/icons-react';
import { Button } from './Button';
import { DialogFrame } from './DialogFrame';

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
    <DialogFrame
      role="alertdialog"
      z={z}
      icon={<IconHelpCircle size={16} className="shrink-0 text-blue-400" />}
      title={title}
      onClose={() => onResult(false)}
      footer={
        <>
          <Button variant="ghost" className="px-4" onClick={() => onResult(false)}>
            {cancelLabel}
          </Button>
          <Button variant="primary" className="px-4" onClick={() => onResult(true)}>
            {okLabel}
          </Button>
        </>
      }
    >
      <span className="whitespace-pre-line">{message}</span>
    </DialogFrame>
  );
}
