import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface LogLine {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

/** Ephemeral event history — excluded from workspace snapshots. */
/** `rotated` counts lines dropped by rotation (renders the reuse note). */
export const consoleState = createStore<{ lines: LogLine[]; rotated: number }>({ lines: [], rotated: 0 });

export function useConsoleLog(): LogLine[] {
  return consoleState.use().lines;
}
