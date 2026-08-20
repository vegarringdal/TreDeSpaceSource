import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { useEffect, useRef } from 'react';
import { CONSOLE_PINNED } from './console.actions';
import { consoleState } from './console.state';

export function Console() {
  useMinSize(220, 90);
  const { lines: log, rotated } = consoleState.use();
  const body = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // Follow new output: stick to the bottom unless the user scrolled up to
  // read something (more than ~40px away from the end).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `log` is the intentional trigger — re-check the scroll position on every new console line
  useEffect(() => {
    const el = body.current;
    if (!el) {
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (nearBottom) {
      end.current?.scrollIntoView({ block: 'end' });
    }
  }, [log]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, []);

  const row = (line: { id: number; level: string; text: string }) => (
    <div
      key={line.id}
      className={`flex gap-2 ${line.level === 'warn' ? 'text-amber-400' : line.level === 'error' ? 'text-red-400' : ''}`}
    >
      <span className="w-9 shrink-0 text-slate-500 uppercase">{line.level}</span>
      {line.text}
    </div>
  );

  return (
    <PanelBody ref={body} className="panel-body p-1 pr-2">
      <div className="font-mono text-xs leading-relaxed">
        {log.length === 0 && <p className="note">Nothing yet. Change something in the Inspector.</p>}
        {log.slice(0, CONSOLE_PINNED).map(row)}
        {rotated > 0 && (
          <div className="my-0.5 border-slate-800 border-y py-0.5 text-slate-500">
            — older messages are reused: keeping the last 100 ({rotated.toLocaleString()} rotated out) —
          </div>
        )}
        {log.slice(CONSOLE_PINNED).map(row)}
        <div ref={end} />
      </div>
    </PanelBody>
  );
}
