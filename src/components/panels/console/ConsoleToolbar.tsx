import { IconEraser } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { consoleActions } from './console.actions';
import { LOG_LEVELS, type LogLevel } from './console.state';

type ConsoleToolbarProps = Readonly<{
  counts: Record<LogLevel, number>;
  shown: Record<LogLevel, boolean>;
  canClear: boolean;
}>;

const LEVEL_HOTKEY: Record<LogLevel, string> = {
  info: 'console.toggleInfo',
  warn: 'console.toggleWarn',
  error: 'console.toggleError',
};

/** The Console's header row: one toggle per level (with its line count) and
 *  Clear. The toggles filter the view; Clear drops everything after the
 *  startup block. */
export function ConsoleToolbar({ counts, shown, canClear }: ConsoleToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-slate-800 border-b p-1">
      {LOG_LEVELS.map((level) => (
        <Button
          key={level}
          active={shown[level]}
          className="h-auto min-h-5 py-0.5 uppercase"
          shortcut={LEVEL_HOTKEY[level]}
          tooltip={`Show / hide ${level} lines`}
          onClick={() => consoleActions.toggleLevel(level)}
        >
          {level}
          <span className="text-slate-500">{counts[level].toLocaleString()}</span>
        </Button>
      ))}
      <div className="flex-1" />
      <Button
        iconOnly
        icon={<IconEraser />}
        disabled={!canClear}
        tooltip="Clear the console — the startup lines (welcome, version, GPU checks) stay"
        shortcut="console.clear"
        onClick={() => consoleActions.clear()}
      />
    </div>
  );
}
