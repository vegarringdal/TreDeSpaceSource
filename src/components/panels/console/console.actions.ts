import { consoleState, type LogLine } from './console.state';

let seq = 0;

// The first PINNED lines (the welcome banner + initial-load events) are kept
// forever; once the log passes PINNED + KEEP, the lines AFTER the pinned block
// rotate so only the most recent KEEP survive (a note row in the panel says so).
const PINNED = 10;
const KEEP = 100;

export const consoleActions = {
  log(level: LogLine['level'], text: string) {
    consoleState.set((s) => {
      const lines = [...s.lines, { id: ++seq, level, text }];
      if (lines.length <= PINNED + KEEP) {
        return { lines };
      }
      const dropped = lines.length - PINNED - KEEP;
      return {
        lines: [...lines.slice(0, PINNED), ...lines.slice(PINNED).slice(-KEEP)],
        rotated: s.rotated + dropped,
      };
    });
  },
  clear() {
    consoleState.set({ lines: [], rotated: 0 });
  },
};

/** Where the rotation note renders (after the pinned initial-load block). */
export const CONSOLE_PINNED = PINNED;
