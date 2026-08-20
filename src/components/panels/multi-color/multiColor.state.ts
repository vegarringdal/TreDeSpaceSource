import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface FilterRow {
  op: 'append' | 'remove';
  mode: 'contains' | 'single' | 'multi' | 'starts' | 'ends' | 'wildcard';
  value: string;
  comment: string;
  /** Hierarchy level (tree-panel counting, folders included) the row applies
   *  at — matches are lifted to their ancestor at this level. 0 = off. */
  level: number;
}

export interface ColorRule {
  comment: string;
  /** disabled rules are skipped by Run */
  enabled: boolean;
  filters: FilterRow[];
  /** hex color override, or null = DEFAULT (no color change) */
  color: string | null;
  /** 0-1, 1 = default (no opacity change) */
  opacity: number;
  /** Scope: only models loaded from this store ('' = all stores). Keeps a
   *  rule set safe when stores contain same-named models. */
  store: string;
}

/** Run mode: reset = clear every existing color/opacity override first;
 *  append = layer on top; hide = hide EVERYTHING first — the rules unhide
 *  (and color) exactly what they match. */
export type ColorRulesMode = 'reset' | 'append' | 'hide';

export interface MultiColorState {
  mode: ColorRulesMode;
  rules: ColorRule[];
  /** per-rule match counts from the last run (null before any run) */
  counts: (number | null)[];
  running: boolean;
}

export const emptyFilterRow = (): FilterRow => ({ op: 'append', mode: 'contains', value: '', comment: '', level: 0 });
export const emptyRule = (): ColorRule => ({
  comment: '',
  enabled: true,
  filters: [emptyFilterRow()],
  color: null,
  opacity: 1,
  store: '',
});

/** Coerce loaded/imported rules into the current shape (older saves lack fields). */
export function normalizeRules(rules: unknown): ColorRule[] {
  if (!Array.isArray(rules)) {
    return [];
  }
  return rules.map((raw) => {
    const r = { ...emptyRule(), ...(raw as Partial<ColorRule>) };
    const filters = Array.isArray(r.filters) ? r.filters : [];
    return { ...r, filters: filters.length ? filters.map((f) => ({ ...emptyFilterRow(), ...f })) : [emptyFilterRow()] };
  });
}

/** True for the exact never-touched default rule set (empty, or one rule with
 *  no comment, Default color, opacity 1 and a single blank filter). Viewpoint
 *  capture uses this to store "no rules tied" instead of a meaningless copy —
 *  a rule set the user actually TOUCHED is never pristine, even when it only
 *  sets Default colors (that's a deliberate "reset to default" and must run). */
export function isPristineRuleSet(rules: ColorRule[]): boolean {
  if (rules.length === 0) {
    return true;
  }
  if (rules.length !== 1) {
    return false;
  }
  const r = rules[0];
  return (
    r.color == null &&
    r.opacity === 1 &&
    r.comment === '' &&
    r.store === '' &&
    r.filters.length === 1 &&
    r.filters[0].value.trim() === '' &&
    r.filters[0].comment === ''
  );
}

/** Fresh editor state — also used for per-viewpoint rule stores. */
export const emptyMultiColorState = (): MultiColorState => ({
  mode: 'reset',
  rules: [emptyRule()],
  counts: [],
  running: false,
});

// Deliberately NOT persisted: rules reference the loaded MODEL's names, and a
// refresh may load a different one — the editor always starts clean. Keeping a
// rule set is what Save…/Load… (JSON file) is for.
export const multiColorState = createStore<MultiColorState>(emptyMultiColorState());
