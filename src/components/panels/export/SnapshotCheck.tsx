import { cn } from '@treDeSpaceUI/lib/cn';
import type { ExportState } from './export.state';
import { exportState } from './export.state';

/** Boolean keys of the export store — the only ones a checkbox row can drive. */
type BooleanKey = {
  [K in keyof ExportState]: ExportState[K] extends boolean ? K : never;
}[keyof ExportState];

interface SnapshotCheckProps {
  field: BooleanKey;
  label: string;
  /** Hotkey binding id (every snapshot option has one). */
  shortcut: string;
  tooltip: string;
  className?: string;
}

/** One snapshot option checkbox bound to an export-store boolean — the six
 *  save/load option rows differ only in field, label and copy. */
export function SnapshotCheck({ field, label, shortcut, tooltip, className }: SnapshotCheckProps) {
  const s = exportState.use();
  return (
    <label
      className={cn('flex cursor-pointer items-center gap-2 text-slate-300 text-xs', className)}
      data-shortcut={shortcut}
      data-tooltip={tooltip}
    >
      <input type="checkbox" checked={s[field]} onChange={(e) => exportState.set({ [field]: e.target.checked })} />
      {label}
    </label>
  );
}
