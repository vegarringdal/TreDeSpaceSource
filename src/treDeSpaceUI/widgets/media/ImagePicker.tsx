import { IconPhotoPlus, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../Button';
import type { LabelledProps } from '../fieldChrome';
import { Labelled } from '../fieldChrome';
import { useFilePicker } from '../useFilePicker';

export interface ImagePickerProps extends LabelledProps {
  /** A `data:` URI, or null for no image. */
  value: string | null;
  /** Receives the picked image as a data: URI, or null when cleared. */
  onChange: (value: string | null) => void;
  /** Largest file accepted, in bytes (bigger files are refused with a note). */
  maxBytes: number;
  /** File-dialog filter (default PNG / JPEG / WebP / SVG). */
  accept?: string;
  /** Styled tooltip (data-tooltip) for the whole row. */
  tooltip?: string;
}

const DEFAULT_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

/** Read a file as a data: URI. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => (typeof fr.result === 'string' ? resolve(fr.result) : reject(new Error('unreadable')));
    fr.onerror = () => reject(fr.error ?? new Error('unreadable'));
    fr.readAsDataURL(file);
  });
}

/**
 * Pick an image from disk into a `data:` URI (never a URL — the value stays
 * self-contained, so it can be saved in a file and drawn without network
 * access). Shows a thumbnail with a clear button; files over `maxBytes` are
 * refused with an inline note.
 */
export function ImagePicker({
  value,
  onChange,
  maxBytes,
  accept = DEFAULT_ACCEPT,
  tooltip,
  disabled = false,
  className = '',
  ...labelled
}: ImagePickerProps) {
  const [error, setError] = useState<string | null>(null);
  const picker = useFilePicker(accept, (file) => {
    if (file.size > maxBytes) {
      setError(`Too large (${Math.round(file.size / 1024)} KB; at most ${Math.round(maxBytes / 1024)} KB).`);
      return;
    }
    setError(null);
    readDataUrl(file).then(onChange, () => setError('Could not read that file.'));
  });

  return (
    <Labelled {...labelled} disabled={disabled} className={className}>
      <div className="flex min-w-0 items-center gap-1.5" data-tooltip={tooltip}>
        {picker.element}
        <div
          className={cn(
            'flex h-10 w-14 shrink-0 items-center justify-center border border-slate-700 bg-slate-900',
            !value && 'text-slate-600',
          )}
        >
          {value ? (
            <img src={value} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <IconPhotoPlus size={16} />
          )}
        </div>
        <Button size="sm" disabled={disabled} onClick={picker.open}>
          {value ? 'Replace…' : 'Choose…'}
        </Button>
        {value && (
          <Button
            size="sm"
            iconOnly
            variant="ghost"
            icon={<IconX />}
            tooltip="No image"
            disabled={disabled}
            onClick={() => onChange(null)}
          />
        )}
        {error && <span className="min-w-0 truncate text-[11px] text-red-300">{error}</span>}
      </div>
    </Labelled>
  );
}
