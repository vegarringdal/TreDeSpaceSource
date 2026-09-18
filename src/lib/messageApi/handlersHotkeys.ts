// Hotkey commands: the shortcut table as data (ids, labels, tooltip-ready
// descriptions and the LIVE key combos — the same record the in-app tooltip
// footers read) and running a shortcut by id. See EVENTS.md for the payload
// contracts.
import { hotkeysActions, hotkeysState } from '@treDeSpaceUI/hotkeys';
import { ApiError, type ApiHandler } from './protocol';
import { emitApiEvent } from './transport';

export const hotkeyHandlers: Record<string, ApiHandler> = {
  'hotkeys.list': ({ p }) => {
    const category = typeof p.category === 'string' && p.category ? p.category : null;
    const all = hotkeysActions.list();
    return { hotkeys: category ? all.filter((h) => h.category === category) : all };
  },

  // FIRE-AND-FORGET: the action is started exactly as a key press would start
  // it — `ran` says it was dispatched (or that the def's own context guard
  // blocked it), never that it finished. Results belong to the dedicated
  // commands.
  'hotkeys.run': ({ p }) => {
    if (typeof p.id !== 'string' || !p.id) {
      throw new ApiError('bad-payload', 'id is required — see hotkeys.list');
    }
    const outcome = hotkeysActions.run(p.id);
    if (outcome === 'unknown') {
      throw new ApiError('not-found', `no hotkey "${p.id}" — see hotkeys.list`);
    }
    return { ran: outcome === 'ran' };
  },
};

/** `hotkeys.changed` for hosts: fired from the registry store whenever a
 *  shortcut's override changes (rebind, allow-in-input, timeout, reset, keymap
 *  import, storage-key switch) with the ids affected, so a host mirroring the
 *  shortcuts in its own UI knows when to re-read `hotkeys.list`. */
export function installHotkeyEvents() {
  let prev = hotkeysState.get().overrides;
  hotkeysState.subscribe(() => {
    const next = hotkeysState.get().overrides;
    if (next === prev) {
      return;
    }
    const ids = [...new Set([...Object.keys(prev), ...Object.keys(next)])]
      .filter((id) => JSON.stringify(prev[id]) !== JSON.stringify(next[id]))
      .sort();
    prev = next;
    if (ids.length) {
      emitApiEvent('hotkeys.changed', { ids });
    }
  });
}
