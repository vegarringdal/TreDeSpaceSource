import { createStore } from '../lib/createStore';
import {
  formatSequence,
  HotkeyEngine,
  isFunctionKeySequence,
  parseSequence,
  type Registered,
  type Sequence,
} from './engine';

// Optional host hook: called with a display line every time a shortcut fires
// (this app routes it to the Console). Module-level for the same reason as the
// other widget injection points — dockable panels live in separate React roots.
let announce: ((message: string) => void) | null = null;

/** Host app: receive a "⌨ label · combo" line whenever a shortcut fires. */
export function setHotkeyAnnouncer(fn: ((message: string) => void) | null) {
  announce = fn;
}

/** A shortcut the user completed inside a text field where it is muted (not
 *  `allowInInput`): the keys typed as usual and nothing ran. */
export interface MutedHotkey {
  /** The shortcut's id. */
  id: string;
  /** Its label (for the "nothing happened" note). */
  label: string;
  /** the combo that was pressed, in display grammar */
  keys: string;
}

// Optional host hook for muted presses (this app shows a toast). The engine
// only reports sequences carrying Ctrl/Alt/Meta, so ordinary typing never
// reaches it.
let notifyMuted: ((hit: MutedHotkey) => void) | null = null;

/** Host app: hear about shortcuts muted by text-field focus, to tell the user
 *  why nothing happened. */
export function setHotkeyMutedNotifier(fn: ((hit: MutedHotkey) => void) | null) {
  notifyMuted = fn;
}

/** A shortcut definition (metadata + default + action). Registered at boot. */
export interface HotkeyDef {
  /** Stable dotted id, e.g. "transform.undo" — what `shortcut=` props, `run(id)`
   *  and saved overrides reference; renaming one breaks every caller. */
  id: string;
  /** UI group — one collapsible settings section per category. */
  category: string;
  /** Short name: the settings row and the "⌨ label · combo" announcement. */
  label: string;
  /** One or two sentences ending with a period — the tooltip body of any
   *  control with this `shortcut` and no tooltip of its own, and the settings
   *  text. */
  description: string;
  /** Default combo in display grammar, e.g. "CTRL+Z" or "ALT 101". */
  defaultKeys: string;
  /** The action. Fire-and-forget. */
  run: () => void;
  /** Fire even while a text field has focus. Default: true when the LIVE
   *  combo is all F1–F12, else false; the user's override wins. */
  allowInInput?: boolean;
  /** ms allowed between the steps of THIS sequence (default 1500). */
  timeout?: number;
  /** Extra guard, checked at every key step: while it returns false the
   *  binding is out of the match and its keys reach the page as usual. */
  context?: () => boolean;
  /** 'press' (default) fires on keydown. 'tap' fires on key-up of a single
   *  combo, only if no other key, pointer press or wheel happened while it
   *  was held and it was held no longer than `tapMaxMs` — so a key that is
   *  also a held modifier (Space+click) keeps that meaning. */
  trigger?: 'press' | 'tap';
  /** ms a tap may be held before it counts as a hold (default 1000) */
  tapMaxMs?: number;
}

/** One shortcut as plain data — what a settings panel, a command palette or
 *  a host API shows: the def's metadata plus the LIVE combo (`keys`, the
 *  user's override when there is one). From `hotkeysActions.list()`. */
export interface HotkeyInfo {
  /** As on the HotkeyDef. */
  id: string;
  /** As on the HotkeyDef. */
  category: string;
  /** As on the HotkeyDef. */
  label: string;
  /** As on the HotkeyDef. */
  description: string;
  /** effective combo in display grammar, e.g. "ALT 101" */
  keys: string;
  /** The def's default combo (display grammar). */
  defaultKeys: string;
  /** true when the user has overridden anything on this shortcut */
  isCustom: boolean;
  /** fires inside text fields too (explicit flag, or a pure F-key combo) */
  allowInInput: boolean;
}

interface Override {
  keys?: Sequence;
  allowInInput?: boolean;
  timeout?: number;
}

/** Keymap file format: 2 = the CTRL+Z / "ALT 101" display notation. */
export const KEYMAP_VERSION = 2;

// localStorage: Record<id, Override> — an app that namespaces its storage moves it (setStorageKey)
let storageKey = 'hotkeys';
const engine = new HotkeyEngine();
engine.setMutedListener((r) => {
  const d = hotkeysState.get().defs[r.id];
  if (d) {
    notifyMuted?.({ id: d.id, label: d.label, keys: formatSequence(r.sequence) });
  }
});

function loadOverrides(): Record<string, Override> {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
  } catch {
    return {};
  }
}

export const hotkeysState = createStore<{
  defs: Record<string, HotkeyDef>;
  order: string[]; // registration order (for stable grouped display)
  overrides: Record<string, Override>;
}>({ defs: {}, order: [], overrides: loadOverrides() });

/** Effective sequence: user override, else the def's parsed defaultKeys. */
function effective(d: HotkeyDef, ov?: Override): Sequence {
  return ov?.keys ?? parseSequence(d.defaultKeys);
}

/** Effective "fires inside text fields": the user's override, else the def's
 *  flag, else true for a pure F-key combo — it types nothing, so a field has
 *  no claim on it. Tied to the LIVE sequence: rebinding an F-key slot to
 *  letters mutes it in fields again, rebinding onto F-keys unmutes. */
function allowsInput(d: HotkeyDef, seq: Sequence, ov?: Override): boolean {
  return ov?.allowInInput ?? d.allowInInput ?? isFunctionKeySequence(seq);
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(hotkeysState.get().overrides));
}

function rebuild() {
  const { defs, overrides } = hotkeysState.get();
  const list: Registered[] = Object.values(defs).map((d) => {
    const sequence = effective(d, overrides[d.id]);
    return {
      id: d.id,
      sequence,
      // announce the shortcut (Console in this app) when it fires, then run
      run: () => {
        announce?.(`⌨ ${d.label} · ${formatSequence(sequence)}`);
        d.run();
      },
      timeout: overrides[d.id]?.timeout ?? d.timeout,
      allowInInput: allowsInput(d, sequence, overrides[d.id]),
      context: d.context,
      trigger: d.trigger,
      tapMaxMs: d.tapMaxMs,
    };
  });
  engine.setBindings(list);
}

export const hotkeysActions = {
  /** Register the whole table once at boot; also starts the engine. */
  register(defs: HotkeyDef[]) {
    const map: Record<string, HotkeyDef> = {};
    const order: string[] = [];
    for (const d of defs) {
      if (map[d.id]) {
        console.warn(`duplicate hotkey id: ${d.id}`);
      } else {
        order.push(d.id);
      }
      map[d.id] = d;
    }
    hotkeysState.set({ defs: map, order });
    rebuild();
    engine.start();
  },

  /** Every registered shortcut as plain data, in registration order, with
   *  its LIVE combo — the one record for a settings panel, a command palette
   *  or a host API. */
  list(): HotkeyInfo[] {
    const { defs, order, overrides } = hotkeysState.get();
    return order.map((id) => {
      const d = defs[id];
      const ov = overrides[id];
      const seq = effective(d, ov);
      return {
        id,
        category: d.category,
        label: d.label,
        description: d.description,
        keys: formatSequence(seq),
        defaultKeys: d.defaultKeys,
        isCustom: id in overrides,
        allowInInput: allowsInput(d, seq, ov),
      };
    });
  },

  /** Fire a shortcut's action by id, as pressing its keys would: the def's
   *  `context` guard is honoured ('blocked' when it says no) and the
   *  announcer gets the same line. Fire-and-forget — the action may carry on
   *  asynchronously; 'ran' only means it was dispatched. */
  run(id: string): 'ran' | 'blocked' | 'unknown' {
    const { defs, overrides } = hotkeysState.get();
    const d = defs[id];
    if (!d) {
      return 'unknown';
    }
    if (d.context && !d.context()) {
      return 'blocked';
    }
    announce?.(`⌨ ${d.label} · ${formatSequence(effective(d, overrides[id]))}`);
    d.run();
    return 'ran';
  },

  /** Effective (override or default) sequence for one id. */
  sequenceFor(id: string): Sequence | null {
    const { defs, overrides } = hotkeysState.get();
    return defs[id] ? effective(defs[id], overrides[id]) : null;
  },

  /** Description text for an id — reused as a tooltip when a control has a
   *  shortcut but no explicit tooltip of its own. */
  describe(id: string): string | null {
    return hotkeysState.get().defs[id]?.description ?? null;
  },

  /** True when the shortcut has any user override (drives the Reset button). */
  isCustom(id: string): boolean {
    return id in hotkeysState.get().overrides;
  },

  /** Conflict check: every OTHER id whose effective sequence is EXACTLY `seq`
   *  (prefixes are allowed to coexist — a shorter match fires on timeout). */
  conflictsFor(seq: Sequence, excludeId?: string): string[] {
    const { defs, overrides } = hotkeysState.get();
    const target = seq.join(' ');
    return Object.values(defs)
      .filter((d) => d.id !== excludeId)
      .filter((d) => effective(d, overrides[d.id]).join(' ') === target)
      .map((d) => d.id);
  },

  setOverride(id: string, keys: Sequence) {
    const ov = hotkeysState.get().overrides;
    hotkeysState.set({ overrides: { ...ov, [id]: { ...ov[id], keys } } });
    persist();
    rebuild();
  },

  setAllowInInput(id: string, allow: boolean) {
    const ov = hotkeysState.get().overrides;
    hotkeysState.set({ overrides: { ...ov, [id]: { ...ov[id], allowInInput: allow } } });
    persist();
    rebuild();
  },

  setTimeout(id: string, ms: number) {
    const ov = hotkeysState.get().overrides;
    hotkeysState.set({ overrides: { ...ov, [id]: { ...ov[id], timeout: ms } } });
    persist();
    rebuild();
  },

  resetOne(id: string) {
    const overrides = { ...hotkeysState.get().overrides };
    delete overrides[id];
    hotkeysState.set({ overrides });
    persist();
    rebuild();
  },

  /** Persist the overrides under another localStorage key (an app that
   *  namespaces its storage) — the overrides are reloaded from it. */
  setStorageKey(key: string) {
    storageKey = key;
    hotkeysState.set({ overrides: loadOverrides() });
    rebuild();
  },

  resetAll() {
    hotkeysState.set({ overrides: {} });
    localStorage.removeItem(storageKey);
    rebuild();
  },

  // -----------------------------------------------------------------------------
  // share: export / import a keymap as JSON
  // -----------------------------------------------------------------------------
  /** Only the deltas from default, keyed by stable id; keys are display strings
   *  so the file is human-readable. Version 2 = the CTRL+Z / "ALT 101"
   *  notation; version 1 files (CTRL&Z / "ALT + 101") are not imported. */
  exportJson(): string {
    const { defs, overrides } = hotkeysState.get();
    const out: Record<string, { keys?: string; allowInInput?: boolean; timeout?: number }> = {};
    for (const [id, ov] of Object.entries(overrides)) {
      if (!defs[id]) {
        continue;
      }
      out[id] = {
        ...(ov.keys ? { keys: formatSequence(ov.keys) } : {}),
        ...(ov.allowInInput != null ? { allowInInput: ov.allowInInput } : {}),
        ...(ov.timeout != null ? { timeout: ov.timeout } : {}),
      };
    }
    return JSON.stringify({ version: KEYMAP_VERSION, bindings: out }, null, 2);
  },

  /** Load a keymap. Defensive: unknown ids, unparseable keys and conflicts are
   *  skipped; returns a report so the panel can show what happened. */
  importJson(text: string): { applied: string[]; skipped: string[]; conflicts: string[] } {
    const report = { applied: [] as string[], skipped: [] as string[], conflicts: [] as string[] };
    let parsed: {
      version?: number;
      bindings?: Record<string, { keys?: string; allowInInput?: boolean; timeout?: number }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('not valid JSON');
    }
    if (parsed.version !== KEYMAP_VERSION) {
      throw new Error(
        `keymap version ${parsed.version ?? '?'} is not supported — it was exported before the shortcut notation changed (CTRL&Z → CTRL+Z, "ALT + 101" → "ALT 101"); record the shortcuts again and export a new file`,
      );
    }
    const { defs } = hotkeysState.get();
    const next = { ...hotkeysState.get().overrides };
    for (const [id, entry] of Object.entries(parsed.bindings ?? {})) {
      if (!defs[id]) {
        report.skipped.push(id);
        continue;
      }
      let keys: Sequence | undefined;
      if (entry.keys) {
        try {
          keys = parseSequence(entry.keys);
        } catch {
          report.skipped.push(id);
          continue;
        }
        if (hotkeysActions.conflictsFor(keys, id).length) {
          report.conflicts.push(id);
          continue;
        }
      }
      next[id] = {
        ...(keys ? { keys } : {}),
        ...(entry.allowInInput != null ? { allowInInput: entry.allowInInput } : {}),
        ...(entry.timeout != null ? { timeout: entry.timeout } : {}),
      };
      report.applied.push(id);
    }
    hotkeysState.set({ overrides: next });
    persist();
    rebuild();
    return report;
  },
};

export { formatSequence };
