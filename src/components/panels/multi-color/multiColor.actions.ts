import type { Store } from '@treDeSpaceUI/lib/createStore';
import { packHex } from '../../../lib/color/hexColor';
import { parseMultiColumn } from '../../../lib/color/multiColorParse';
import type { ColorRuleSpec } from '../../../lib/modeldb/modeldbWorker';
import { loadedIndicesForStore } from '../../../state/viewer/storeScope';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import {
  type ColorRule,
  type ColorRulesMode,
  emptyFilterRow,
  emptyRule,
  type FilterRow,
  type MultiColorState,
  multiColorState,
  normalizeRules,
} from './multiColor.state';

/** A ColorRule → worker spec. `multi` filters may carry a per-line color in a
 *  2nd column (TAB/comma); those colors override the rule color per fullname
 *  (perNameColor). Shared so the SQL Reports "Set color" button builds specs
 *  identically. */
export function ruleToSpec(r: ColorRule): ColorRuleSpec {
  const perNameColor: Record<string, number> = {};
  const perNameOpacity: Record<string, number> = {};
  const filters = r.filters
    .filter((f) => f.mode !== 'multi' || f.value.trim().length > 0)
    .map((f) => {
      if (f.mode === 'multi') {
        const { names, perName, perOpacity } = parseMultiColumn(f.value);
        Object.assign(perNameColor, perName);
        Object.assign(perNameOpacity, perOpacity);
        return { op: f.op, mode: f.mode, value: names, level: f.level };
      }
      return { op: f.op, mode: f.mode, value: f.value, level: f.level };
    });
  return {
    filters,
    colorRGBA8: r.color == null ? null : packHex(r.color),
    opacityPct: r.opacity === 1 ? null : Math.round(r.opacity * 100),
    ...(Object.keys(perNameColor).length ? { perNameColor } : {}),
    ...(Object.keys(perNameOpacity).length ? { perNameOpacity } : {}),
  };
}

/** The ENABLED rules as worker specs, store scopes resolved to model
 *  indices (a store with nothing loaded scopes to [] — the rule matches
 *  nothing). Shared by the panel's Run and the GUI-less colorRules.apply
 *  API command. */
export async function specsForRules(rules: ColorRule[]): Promise<ColorRuleSpec[]> {
  const active = rules.filter((r) => r.enabled);
  const specs = active.map(ruleToSpec);
  const storeNames = [...new Set(active.map((r) => r.store).filter(Boolean))];
  const idxByStore = new Map(
    await Promise.all(storeNames.map(async (s) => [s, await loadedIndicesForStore(s)] as const)),
  );
  active.forEach((r, i) => {
    if (r.store) {
      specs[i].models = idxByStore.get(r.store) ?? [];
    }
  });
  return specs;
}

/** Build a Set Color action set bound to a specific store — the global panel
 *  uses the persisted multiColorState; the "(viewpoint)" panel binds the same
 *  editor to the active viewpoint's own rules. */
export function makeMultiColorActions(store: Store<MultiColorState>) {
  function patchRule(i: number, patch: Partial<ColorRule>) {
    store.set((s) => ({
      rules: s.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)),
    }));
  }

  return {
    setMode(mode: ColorRulesMode) {
      store.set({ mode });
    },

    addRule() {
      store.set((s) => ({ rules: [...s.rules, emptyRule()] }));
    },

    /** Insert a fresh rule directly BEFORE rule i. */
    insertRuleBefore(i: number) {
      store.set((s) => ({
        rules: [...s.rules.slice(0, i), emptyRule(), ...s.rules.slice(i)],
        counts: [...s.counts.slice(0, i), null, ...s.counts.slice(i)],
      }));
    },

    /** Move rule i one step up (-1) or down (+1) in the run order. */
    moveRule(i: number, dir: -1 | 1) {
      store.set((s) => {
        const j = i + dir;
        if (j < 0 || j >= s.rules.length) {
          return {};
        }
        const rules = [...s.rules];
        [rules[i], rules[j]] = [rules[j], rules[i]];
        const counts = [...s.counts];
        [counts[i], counts[j]] = [counts[j] ?? null, counts[i] ?? null];
        return { rules, counts };
      });
    },

    removeRule(i: number) {
      store.set((s) => ({
        rules: s.rules.filter((_, k) => k !== i),
        counts: s.counts.filter((_, k) => k !== i),
      }));
    },

    updateRule: patchRule,

    addFilter(i: number) {
      const rule = store.get().rules[i];
      if (rule) {
        patchRule(i, { filters: [...rule.filters, emptyFilterRow()] });
      }
    },

    removeFilter(i: number, j: number) {
      const rule = store.get().rules[i];
      if (rule) {
        patchRule(i, { filters: rule.filters.filter((_, k) => k !== j) });
      }
    },

    /** The "+" on a filter row: put the LAST selected name (the current
     *  selection root — tree click, viewport pick, U / P) into the row:
     *  replaces the text, or in Multi mode appends it as a new line. */
    async insertSelectedName(i: number, j: number) {
      const name = await viewerActions.lastSelectedName();
      if (!name) {
        consoleActions.log('warn', 'Set Color: nothing is selected — select in the tree or the viewport first');
        return;
      }
      const f = store.get().rules[i]?.filters[j];
      if (!f) {
        return;
      }
      const value = f.mode === 'multi' && f.value.trim() ? `${f.value.replace(/\s+$/, '')}\n${name}` : name;
      patchRule(i, { filters: store.get().rules[i].filters.map((x, k) => (k === j ? { ...x, value } : x)) });
    },

    updateFilter(i: number, j: number, patch: Partial<FilterRow>) {
      const rule = store.get().rules[i];
      if (rule) {
        patchRule(i, { filters: rule.filters.map((f, k) => (k === j ? { ...f, ...patch } : f)) });
      }
    },

    toggleRule(i: number) {
      const rule = store.get().rules[i];
      if (rule) {
        patchRule(i, { enabled: !rule.enabled });
      }
    },

    /** Run every enabled rule in order (worker-side). Stores per-rule match
     *  counts (disabled rules show none). Blocks the UI while running. */
    async run() {
      const { rules, mode, running } = store.get();
      const active = rules.filter((r) => r.enabled);
      if (running || active.length === 0) {
        return;
      }
      store.set({ running: true });
      dialogs.loading('Applying color rules…', 'Set Color');
      try {
        const specs = await specsForRules(rules);
        const ran = await viewerActions.applyColorRules(specs, mode);
        // map the enabled-only counts back onto the full rule list
        let k = 0;
        const counts = rules.map((r) => (r.enabled ? (ran[k++] ?? null) : null));
        store.set({ counts });
        consoleActions.log(
          'info',
          `Set Color → ${active.length} rule${active.length === 1 ? '' : 's'} run (${mode}); matches: ${ran.join(', ')}`,
        );
      } catch (e) {
        consoleActions.log('error', `Set Color failed: ${e}`);
        dialogs.error(`Running the color rules failed: ${e}`, 'Set Color');
      } finally {
        dialogs.hideLoading();
        store.set({ running: false });
      }
    },

    /** Download the whole rule set (mode + rules) as a JSON file. */
    saveToFile() {
      const { mode, rules } = store.get();
      const blob = new Blob([JSON.stringify({ version: 1, mode, rules }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'set-color-rules.json';
      a.click();
      URL.revokeObjectURL(url);
    },

    /** Replace the current rule set from a saved JSON file. */
    loadFromText(text: string) {
      try {
        const data = JSON.parse(text) as { mode?: ColorRulesMode; rules?: unknown };
        const rules = normalizeRules(data.rules);
        if (!rules.length) {
          throw new Error('no rules found in the file');
        }
        store.set({
          mode: data.mode === 'append' || data.mode === 'hide' ? data.mode : 'reset',
          rules,
          counts: [],
        });
        consoleActions.log('info', `Set Color → loaded ${rules.length} rule${rules.length === 1 ? '' : 's'} from file`);
      } catch (e) {
        dialogs.error(`Could not load the rules file: ${e}`, 'Set Color');
      }
    },
  };
}

export type MultiColorActions = ReturnType<typeof makeMultiColorActions>;

/** The global Set Color panel's actions (persisted multiColorState). */
export const multiColorActions = makeMultiColorActions(multiColorState);
