import { downloadText } from '../../../lib/download';
import { type ConsoleState, consoleState, type LogLevel } from './console.state';

let seq = 0;

// The startup block (welcome banner, version, GPU checks) is pinned: it never
// rotates and Clear keeps it. Its length is fixed when the viewport marks
// startup done; until then (a boot that dies before the GPU checks) the first
// PINNED_FALLBACK lines stand in. Past the pinned block only the most recent
// KEEP lines survive (a note row in the panel says so).
const PINNED_FALLBACK = 10;
const KEEP = 1500;

/** How many leading lines are pinned right now. */
export function consolePinned(s: ConsoleState): number {
  return s.pinned > 0 ? s.pinned : Math.min(s.lines.length, PINNED_FALLBACK);
}

export const consoleActions = {
  /** Append a line; returns its id. */
  log(level: LogLevel, text: string): number {
    const id = ++seq;
    consoleState.set((s) => {
      const lines = [...s.lines, { id, level, text }];
      const pinned = consolePinned(s);
      if (lines.length <= pinned + KEEP) {
        return { lines };
      }
      const dropped = lines.length - pinned - KEEP;
      return {
        lines: [...lines.slice(0, pinned), ...lines.slice(pinned).slice(-KEEP)],
        rotated: s.rotated + dropped,
      };
    });
    return id;
  },

  /** Freeze the startup block at everything logged so far — called once the
   *  GPU checks have printed (or failed). Later calls (the viewport panel
   *  re-initialising) leave the first mark alone. */
  markStartupDone() {
    consoleState.set((s) => (s.pinned > 0 ? {} : { pinned: s.lines.length }));
  },

  /** Drop everything after the startup block; the pinned lines stay. Returns
   *  how many lines went. */
  clear(): number {
    const s = consoleState.get();
    const keep = consolePinned(s);
    consoleState.set({ lines: s.lines.slice(0, keep), rotated: 0 });
    return s.lines.length - keep;
  },

  /** Show / hide one level in the panel (a view filter — nothing is dropped). */
  toggleLevel(level: LogLevel) {
    consoleState.set((s) => ({ shown: { ...s.shown, [level]: !s.shown[level] } }));
  },

  /** Everything the panel holds as plain text — every level, whatever the
   *  view filter, startup block first — under a header naming the build,
   *  the browser, the pixel ratio and the viewport, so a log sent from
   *  another device says where it came from. */
  exportText(): string {
    const s = consoleState.get();
    const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
    const head = [
      `TreDeSpace console log — ${new Date().toISOString()}`,
      `version: ${version}`,
      `userAgent: ${navigator.userAgent}`,
      `devicePixelRatio: ${window.devicePixelRatio}`,
      `viewport: ${window.innerWidth}x${window.innerHeight}`,
    ];
    if (s.rotated > 0) {
      head.push(`(${s.rotated} older lines rotated out)`);
    }
    head.push('');
    const body = s.lines.map((l) => `[${l.level}] ${l.text}`);

    return [...head, ...body].join('\n');
  },

  /** Save the export as a .txt — the "send me the log" button. */
  download() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadText(`tredespace-console-${stamp}.txt`, consoleActions.exportText(), 'text/plain');
  },
};

/** Lines kept past the pinned block (the rotation note quotes it). */
export const CONSOLE_KEEP = KEEP;
