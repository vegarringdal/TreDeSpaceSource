// Console commands: read, clear and append to the Console panel's log. See
// EVENTS.md for the payload contracts.
import { consoleActions } from '../../components/panels/console/console.actions';
import { consoleState, LOG_LEVELS, type LogLevel } from '../../components/panels/console/console.state';
import { ApiError, type ApiHandler } from './protocol';

const isLevel = (v: unknown): v is LogLevel => typeof v === 'string' && LOG_LEVELS.some((l) => l === v);

/** Optional `levels` filter → the set to keep, or null for every level. */
function levelsFilter(v: unknown): Set<LogLevel> | null {
  if (v === undefined || v === null) {
    return null;
  }
  if (!Array.isArray(v) || !v.every(isLevel)) {
    throw new ApiError('bad-payload', `levels must be an array of ${LOG_LEVELS.join(' | ')}`);
  }
  return new Set(v);
}

/** Optional `limit` → the most-recent count to return, or null for all. */
function limitOf(v: unknown): number | null {
  if (v === undefined || v === null) {
    return null;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new ApiError('bad-payload', 'limit must be a positive integer');
  }
  return v;
}

export const consoleHandlers: Record<string, ApiHandler> = {
  'console.get': ({ p }) => {
    const levels = levelsFilter(p.levels);
    const limit = limitOf(p.limit);
    const s = consoleState.get();
    const filtered = levels ? s.lines.filter((l) => levels.has(l.level)) : s.lines;
    const lines = limit !== null && filtered.length > limit ? filtered.slice(-limit) : filtered;
    return { lines, rotated: s.rotated };
  },

  // the panel's Clear: everything after the startup block goes, the block stays
  'console.clear': () => ({ cleared: consoleActions.clear() }),

  'console.add': ({ p }) => {
    const text = typeof p.text === 'string' ? p.text : '';
    if (!text.trim()) {
      throw new ApiError('bad-payload', 'text is required');
    }
    const level = p.level === undefined ? 'info' : p.level;
    if (!isLevel(level)) {
      throw new ApiError('bad-payload', `level must be ${LOG_LEVELS.join(' | ')}`);
    }
    return { id: consoleActions.log(level, text) };
  },
};
