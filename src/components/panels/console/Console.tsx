import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { cn } from '@treDeSpaceUI/lib/cn';
import { useVirtualRows } from '@treDeSpaceUI/lib/useVirtualRows';
import { useEffect, useRef } from 'react';
import { ConsoleToolbar } from './ConsoleToolbar';
import { CONSOLE_KEEP, consolePinned } from './console.actions';
import { type ConsoleState, consoleState, type LogLevel, type LogLine } from './console.state';

type Row = { kind: 'line'; line: LogLine } | { kind: 'note'; rotated: number };

const ROW_H = 20;
/** within this many px of the end counts as "reading the latest" */
const STICK_PX = 40;

const LEVEL_CLASS: Record<LogLevel, string> = { info: '', warn: 'text-amber-400', error: 'text-red-400' };

/** The rows the list shows: lines passing the level filter, with the
 *  rotation note slotted in right after the pinned startup block. */
function visibleRows(s: ConsoleState): Row[] {
  const pinned = consolePinned(s);
  const rows: Row[] = [];
  s.lines.forEach((line, i) => {
    if (i === pinned && s.rotated > 0) {
      rows.push({ kind: 'note', rotated: s.rotated });
    }
    if (s.shown[line.level]) {
      rows.push({ kind: 'line', line });
    }
  });
  return rows;
}

function levelCounts(s: ConsoleState): Record<LogLevel, number> {
  const counts = { info: 0, warn: 0, error: 0 };
  for (const line of s.lines) {
    counts[line.level]++;
  }
  return counts;
}

export function Console() {
  useMinSize(220, 90);
  const state = consoleState.use();
  const scroller = useRef<HTMLDivElement>(null);
  // follow new output while the user is at (or near) the end; a scroll up to
  // read something older releases it until they come back down
  const stick = useRef(true);
  const rows = visibleRows(state);
  const virtual = useVirtualRows(scroller, rows.length, ROW_H);

  const handleScroll = () => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    virtual.onScroll();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the row count is the intentional trigger — re-stick to the end whenever the list grows or the filter changes
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
      virtual.onScroll();
    }
  }, [rows.length]);

  const rowStyle = (i: number) => ({ top: i * ROW_H, height: ROW_H });
  const empty =
    state.lines.length === 0 ? 'Nothing yet. Change something in the Inspector.' : 'Nothing at the shown levels.';

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden">
      <ConsoleToolbar
        counts={levelCounts(state)}
        shown={state.shown}
        canClear={state.lines.length > consolePinned(state)}
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto font-mono text-xs" onScroll={handleScroll}>
        {rows.length === 0 && <p className="note p-1">{empty}</p>}
        <div style={{ height: virtual.totalH, position: 'relative' }}>
          {rows.slice(virtual.first, virtual.last).map((r, k) => {
            const i = virtual.first + k;
            if (r.kind === 'note') {
              return (
                <div
                  key="note"
                  className="absolute left-0 flex items-center whitespace-nowrap px-1 text-slate-500"
                  style={rowStyle(i)}
                >
                  — older messages are reused: keeping the last {CONSOLE_KEEP} ({r.rotated.toLocaleString()} rotated
                  out) —
                </div>
              );
            }
            return (
              <div
                key={r.line.id}
                className={cn(
                  'absolute left-0 flex items-center gap-2 whitespace-nowrap px-1',
                  LEVEL_CLASS[r.line.level],
                )}
                style={rowStyle(i)}
              >
                <span className="w-9 shrink-0 text-slate-500 uppercase">{r.line.level}</span>
                {r.line.text}
              </div>
            );
          })}
        </div>
      </div>
    </PanelBody>
  );
}
