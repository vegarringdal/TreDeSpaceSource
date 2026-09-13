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
        <Button
          readOnly
          grow
          className={cn(
            'justify-start truncate font-mono text-[11px]',
            recording
              ? 'border-blue-500 bg-blue-950 text-blue-200'
              : custom && 'border-amber-700 bg-amber-950 text-amber-200',
          )}
        >
          {recording ? 'press keys… (Esc)' : seq ? formatSequence(seq) : '—'}
        </Button>
        <Button
          iconOnly
          variant="ghost"
          disabled={!custom}
          icon={<IconX />}
          tooltip={custom ? `Reset to ${def.defaultKeys}` : 'Default binding'}
          onClick={() => hotkeysActions.resetOne(id)}
        />
        <Button disabled={recording} onClick={() => onRecord(id)}>
          Record
        </Button>
      </div>
    </div>
  );
}
