import { useCallback, useRef, useState } from 'react';

export type LogCls = '' | 'ok' | 'err' | 'out';

export type LogLine = Readonly<{ id: number; cls: LogCls; text: string }>;

/** Append-only console log for the demo page (ids are stable render keys). */
export function useDemoLog(): {
  lines: readonly LogLine[];
  line: (cls: LogCls, text: string) => void;
  clearLog: () => void;
} {
  const [lines, setLines] = useState<readonly LogLine[]>([]);
  const nextId = useRef(0);

  const line = useCallback((cls: LogCls, text: string) => {
    const id = nextId.current++;
    setLines((prev) => [...prev, { id, cls, text }]);
  }, []);

  const clearLog = useCallback(() => setLines([]), []);

  return { lines, line, clearLog };
}
