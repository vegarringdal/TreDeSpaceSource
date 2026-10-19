import { IconPencil } from '@tabler/icons-react';
import { Button } from './Button';
import { DialogFrame } from './DialogFrame';
import { TextInput } from './text/TextField';

export interface PromptDialogCoreProps {
  /** Title-bar text. */
  title: string;
  /** The question above the field. */
  message: string;
  /** The field's text — controlled, yours to keep. */
  value: string;
  /** OK button text. */
  okLabel: string;
  /** Cancel button text (default 'Cancel'). */
  cancelLabel?: string;
  /** Receives the text on every keystroke. */
  onChange: (value: string) => void;
  /** Called with true for OK/Enter, false for Cancel, Escape, the backdrop or the ✕. */
  onResult: (ok: boolean) => void;
  /** Stacking layer (default 2000). */
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
    <DialogFrame
      z={z}
      icon={<IconPencil size={16} className="shrink-0 text-blue-400" />}
      title={title}
      onClose={() => onResult(false)}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-4 text-xs leading-relaxed"
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
      <span>{message}</span>
      <TextInput autoFocus clearable={false} value={value} onChange={onChange} onCommit={() => onResult(true)} />
    </DialogFrame>
  );
}
