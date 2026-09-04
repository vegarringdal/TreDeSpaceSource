import { createStore } from '../lib/createStore';
import { formatSequence, HotkeyEngine, parseSequence, type Registered, type Sequence } from './engine';

// Optional host hook: called with a display line every time a shortcut fires
// (this app routes it to the Console). Module-level for the same reason as the
// other widget injection points — dockable panels live in separate React roots.
let announce: ((message: string) => void) | null = null;

/** Host app: receive a "⌨ label · combo" line whenever a shortcut fires. */
export function setHotkeyAnnouncer(fn: ((message: string) => void) | null) {
  announce = fn;
}

/** A shortcut definition (metadata + default + action). Registered at boot. */
export interface HotkeyDef {
  id: string; // stable dotted id, e.g. "transform.undo"
  category: string; // UI group — one collapsible panel per category
  label: string;
  description: string;
  defaultKeys: string; // default combo in display grammar, e.g. "ALT + 101"
  run: () => void;
  allowInInput?: boolean; // default false; user-overridable
  timeout?: number; // ms between steps for THIS shortcut
  context?: () => boolean; // extra guard — must return true for the shortcut to fire
}

interface Override {
  keys?: Sequence;
  allowInInput?: boolean;
  timeout?: number;
}

// localStorage: Record<id, Override> — an app that namespaces its storage moves it (setStorageKey)
let storageKey = 'hotkeys';
const engine = new HotkeyEngine();

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
      allowInInput: overrides[d.id]?.allowInInput ?? d.allowInInput,
      context: d.context,
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
   *  so the file is human-readable and portable across versions. */
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
    return JSON.stringify({ version: 1, bindings: out }, null, 2);
  },

  /** Load a keymap. Defensive: unknown ids, unparseable keys and conflicts are
   *  skipped; returns a report so the panel can show what happened. */
  importJson(text: string): { applied: string[]; skipped: string[]; conflicts: string[] } {
    const report = { applied: [] as string[], skipped: [] as string[], conflicts: [] as string[] };
    let parsed: { bindings?: Record<string, { keys?: string; allowInInput?: boolean; timeout?: number }> };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('not valid JSON');
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
