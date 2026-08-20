import { IconX } from '@tabler/icons-react';
import { formatSequence, type HotkeyDef, hotkeysActions } from '@treDeSpaceUI/hotkeys';
import { cn } from '@treDeSpaceUI/lib/cn';
import { Button } from '@treDeSpaceUI/widgets';

type ShortcutRowProps = Readonly<{
  id: string;
  def: HotkeyDef;
  custom: boolean;
  recording: boolean;
  onRecord: (id: string) => void;
}>;

/** One editable shortcut in the Shortcuts settings: label, description, the
 *  current binding (with per-id reset), and a Record button. */
export function ShortcutRow({ id, def, custom, recording, onRecord }: ShortcutRowProps) {
  const seq = hotkeysActions.sequenceFor(id);

  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <div className="font-medium text-slate-200 text-xs">{def.label}</div>
      <div className="text-[11px] text-slate-500">{def.description}</div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <div
            className={cn(
              'flex h-6 w-full items-center truncate border px-2 pr-6 font-mono text-[11px]',
              recording
                ? 'border-blue-500 bg-blue-950 text-blue-200'
                : custom
                  ? 'border-amber-700 bg-amber-950 text-amber-200'
                  : 'border-slate-700 bg-slate-800 text-slate-300',
            )}
          >
            {recording ? 'press keys… (Esc)' : seq ? formatSequence(seq) : '—'}
          </div>
          <button
            type="button"
            tabIndex={-1}
            disabled={!custom}
            data-tooltip={custom ? `Reset to ${def.defaultKeys}` : 'Default binding'}
            className="absolute top-1/2 right-0.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:text-slate-400"
            onClick={() => hotkeysActions.resetOne(id)}
          >
            <IconX size={13} />
          </button>
        </div>
        <Button disabled={recording} onClick={() => onRecord(id)}>
          Record
        </Button>
      </div>
    </div>
  );
}
