import { createStore } from '@treDeSpaceUI/lib/createStore';

export type LogLevel = 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['info', 'warn', 'error'];

export interface LogLine {
  id: number;
  level: LogLevel;
  text: string;
}

export interface ConsoleState {
  lines: LogLine[];
  /** lines dropped by rotation (renders the reuse note) */
  rotated: number;
  /** how many leading lines are the startup block (welcome, version, GPU
   *  checks) — kept forever and by Clear; 0 until startup is marked done */
  pinned: number;
  /** which levels the panel shows — a view filter, nothing is dropped */
  shown: Record<LogLevel, boolean>;
}

/** Ephemeral event history — excluded from workspace snapshots. */
export const consoleState = createStore<ConsoleState>({
  lines: [],
  rotated: 0,
  pinned: 0,
  shown: { info: true, warn: true, error: true },
});

export function useConsoleLog(): LogLine[] {
  return consoleState.use().lines;
}
