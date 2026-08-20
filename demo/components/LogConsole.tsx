import { useEffect, useRef } from 'react';
import { useDemo } from '../DemoContext';
import type { LogCls } from '../useDemoLog';

const CLS_COLORS: Record<LogCls, string> = {
  '': '',
  ok: 'text-green-400',
  err: 'text-red-400',
  out: 'text-sky-300',
};

/** The request/response console — every command logs here, auto-scrolled. */
export function LogConsole({ className = '' }: Readonly<{ className?: string }>) {
  const { lines } = useDemo();
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && lines.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <pre
      ref={ref}
      className={`m-0 flex-none overflow-y-auto whitespace-pre-wrap bg-slate-950 p-2 font-mono text-[11px] leading-[1.45] ${className}`}
    >
      {lines.map((l) => (
        <span key={l.id} className={CLS_COLORS[l.cls]}>
          {l.text}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}
