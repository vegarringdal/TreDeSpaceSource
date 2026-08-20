// The MultiColor rule engine: resolves each rule's filter rows to an item set
// and writes color/opacity overrides directly on those items. Split out of
// apiColor — the selection-based override actions live there; the shared
// STATE undo stack lives in colorUndo.

import { type ColorUndoRecord, captureColorRuns, pushColorUndo } from './colorUndo';
import {
  type DbModel,
  HAS_COLOR_OVERRIDE,
  HAS_OPACITY_OVERRIDE,
  IS_HIDDEN,
  models,
  NO_PARENT,
  OPACITY_MASK,
  OPACITY_SHIFT,
  type StateUpdate,
} from './dbState';
import { ensureGlobalIndex, hitEntry, hitModel, liveHits } from './globalNameIndex';
import { bfsOrder, ensureNames, entryDepths, itemsUnder, packStates } from './hierarchyIndex';

/** Escape a literal string for embedding in a RegExp (wildcard compile). */
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The model's import-folder path segments (tree-panel top levels). */
function groupSegments(m: DbModel): string[] {
  return m.group.split('/').filter((s) => s.length > 0);
}

/** One MultiColor rule, resolved UI-side into plain data for the worker. */
export interface ColorRuleSpec {
  filters: {
    op: 'append' | 'remove';
    /** contains | single (equals, * at start/end) | starts | ends |
     *  wildcard (equals, * anywhere) | multi (one name per line) */
    mode: 'contains' | 'single' | 'multi' | 'starts' | 'ends' | 'wildcard';
    value: string;
    /** Hierarchy level the filter is applied TO: the row matches only the
     *  NAMES at that level, and each match includes its whole subtree.
     *  Levels count like the tree panel — import-folder segments included,
     *  so 1 = top folder (the filter tests the folder name; a hit takes
     *  every model under it) and the model's root entries sit at
     *  folderDepth+1. 0/omitted = match at any level (entry + subtree). */
    level?: number;
  }[];
  /** packed RGBA8 override, or null = DEFAULT (restore the original mesh color) */
  colorRGBA8: number | null;
  /** 0-100 opacity override, or null = default (restore full original opacity) */
  opacityPct: number | null;
  /** Optional per-fullname color (lowercased fullname → packed RGBA8, or the
   *  negative COLOR_DEFAULT sentinel = restore the original mesh color). A
   *  matched item whose entry name is here uses THAT instead of colorRGBA8 —
   *  this is how one Multi rule carries per-row colors (2-column paste / a
   *  COLORING report's fullname_color). */
  perNameColor?: Record<string, number>;
  /** Optional per-fullname opacity (lowercased fullname → 0-100). Overrides
   *  opacityPct for that item — the `color:opacity` syntax. */
  perNameOpacity?: Record<string, number>;
  /** Worker model indices this rule may touch (store scoping); undefined =
   *  every loaded model, [] = nothing. */
  models?: number[];
}

/** Run the MultiColor rule sequence. Each rule resolves a set of items from
 * its filter rows (append = union, remove = subtract, evaluated in order;
 * a matched entry colors its whole subtree, like selection) and then writes
 * color / opacity overrides directly on those items — the current selection
 * is untouched. Mode: `reset` clears every override first, `append` layers
 * on top, `hide` starts from an all-hidden override-free slate and the
 * rules UNHIDE (and color) exactly what they match. The whole run is ONE
 * step on the state undo stack. Returns per-rule match counts. */
export function applyColorRules(
  rules: ColorRuleSpec[],
  mode: 'reset' | 'append' | 'hide',
  traceOn = false,
): { updates: StateUpdate[]; counts: number[]; trace?: { label: string; ms: number }[] } {
  // ONE undo step for the entire run — reset + every rule, across models.
  // Each touched model's full band is captured ONCE, before its first
  // mutation (however many rules later touch it).
  const undoStep: ColorUndoRecord[] = [];
  const captured = new Set<number>();
  const captureOnce = (idx: number) => {
    if (!captured.has(idx)) {
      captured.add(idx);
      undoStep.push(captureColorRuns(idx));
    }
  };
  // opt-in phase timer (Settings → Stats → Verbose trace). No-op when off.
  const T = traceOn
    ? {
        last: performance.now(),
        rows: [] as { label: string; ms: number }[],
        mark(label: string) {
          const now = performance.now();
          this.rows.push({ label: `worker: ${label}`, ms: now - this.last });
          this.last = now;
        },
      }
    : null;
  // per-phase accumulators (summed across the model/rule loops)
  const acc = traceOn ? { names: 0, match: 0, perName: 0, write: 0 } : null;
  const clk = () => performance.now();
  // A filter compiled to a descriptor (built ONCE per rule, not per model):
  //   'all'   → matches everything (blank filter): callers fill, no scan
  //   names[] → multi paste: resolve each via the model's nameIndex (O(tags));
  //             keeps the raw name set for folder-level tests
  //   fn      → contains/equals wildcard: must scan entries
  type Matcher = 'all' | { byModel: Map<number, number[]>; names: Set<string> } | { fn: (n: string) => boolean } | null;
  /** Resolve names ONCE via the global index into per-model entry lists —
   *  O(names) total instead of O(names × models). */
  const resolveNames = (names: string[]): Map<number, number[]> => {
    const byModel = new Map<number, number[]>();
    for (const name of names) {
      liveHits(name, (p) => {
        const mi = hitModel(p);
        const list = byModel.get(mi);
        if (list) {
          list.push(hitEntry(p));
        } else {
          byModel.set(mi, [hitEntry(p)]);
        }
      });
    }
    return byModel;
  };
  /** Same, for per-fullname value records → per-model [entry, value] pairs. */
  const resolvePerName = (rec: Record<string, number>): Map<number, [number, number][]> => {
    const byModel = new Map<number, [number, number][]>();
    for (const [name, value] of Object.entries(rec)) {
      liveHits(name, (p) => {
        const mi = hitModel(p);
        const list = byModel.get(mi);
        if (list) {
          list.push([hitEntry(p), value]);
        } else {
          byModel.set(mi, [[hitEntry(p), value]]);
        }
      });
    }
    return byModel;
  };
  const rowMatcher = (row: ColorRuleSpec['filters'][number]): Matcher => {
    if (row.mode === 'multi') {
      const names = row.value
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 0);
      return names.length ? { byModel: resolveNames(names), names: new Set(names) } : null;
    }
    let q = row.value.trim().toLowerCase();
    if (!q.replaceAll('*', '').length) {
      return 'all'; // blank / bare * = everything
    }
    if (row.mode === 'contains') {
      return { fn: (n) => n.includes(q) };
    }
    if (row.mode === 'starts') {
      return { fn: (n) => n.startsWith(q) };
    }
    if (row.mode === 'ends') {
      return { fn: (n) => n.endsWith(q) };
    }
    if (row.mode === 'wildcard') {
      // equals with * anywhere: segments must appear in order, anchored at
      // both ends ("pu*01" matches "pump-01" but not "x-pump-01-y")
      const re = new RegExp(`^${q.split('*').map(escapeRegExp).join('.*')}$`);
      return { fn: (n) => re.test(n) };
    }
    const startsWild = q.startsWith('*');
    const endsWild = q.endsWith('*');
    q = q.replace(/^\*+|\*+$/g, '');
    if (startsWild && endsWild) {
      return { fn: (n) => n.includes(q) };
    }
    if (startsWild) {
      return { fn: (n) => n.endsWith(q) };
    }
    if (endsWild) {
      return { fn: (n) => n.startsWith(q) };
    }
    return { fn: (n) => n === q };
  };
  const counts: number[] = [];
  const touched = new Set<number>();
  if (mode === 'hide') {
    // HIDE MODEL: every item hidden and override-free — the rule writes
    // below then unhide their matches, so the scene shows exactly the
    // matched (and freshly colored) items
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      captureOnce(idx);
      for (let i = 0; i < m.itemCount; i++) {
        m.states[i * 2] =
          ((m.states[i * 2] & ~(HAS_COLOR_OVERRIDE | HAS_OPACITY_OVERRIDE | OPACITY_MASK)) | IS_HIDDEN) >>> 0;
      }
      touched.add(idx);
    });
  } else if (mode === 'reset') {
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      const items: number[] = [];
      for (let i = 0; i < m.itemCount; i++) {
        if (m.states[i * 2] & (HAS_COLOR_OVERRIDE | HAS_OPACITY_OVERRIDE)) {
          items.push(i);
        }
      }
      if (!items.length) {
        return;
      }
      captureOnce(idx);
      for (const i of items) {
        m.states[i * 2] = (m.states[i * 2] & ~(HAS_COLOR_OVERRIDE | HAS_OPACITY_OVERRIDE | OPACITY_MASK)) >>> 0;
      }
      touched.add(idx);
    });
  }
  T?.mark('reset overrides');
  const sIndex = acc ? clk() : 0;
  ensureGlobalIndex(); // names + global fullname index, built once, cached
  if (acc) {
    acc.names += clk() - sIndex;
  }
  const NONE = -2; // "unset / inherit from parent" sentinel
  for (const rule of rules) {
    let total = 0;
    // compile matchers ONCE per rule: the multi paste is split AND resolved
    // to per-model entry lists here, not re-resolved for every model.
    const appendOnly = rule.filters.every((f) => f.op === 'append');
    const matchers = rule.filters.map((row) => ({ op: row.op, level: row.level ?? 0, m: rowMatcher(row) }));
    /** Level-restricted row against one model's FOLDER segments: the filter
     *  tests the folder NAME at that level; a hit takes the whole model
     *  (undefined = the level is below the folders → entry matching). */
    const folderNameHit = (m: DbModel, mt: Matcher, level: number): boolean | undefined => {
      const segs = groupSegments(m);
      if (level > segs.length) {
        return undefined;
      }
      const segName = segs[level - 1].toLowerCase();
      if (mt === 'all' || mt === null) {
        return mt === 'all';
      }
      return 'byModel' in mt ? mt.names.has(segName) : mt.fn(segName);
    };
    // per-name colour/opacity resolved ONCE globally → per-model [entry, value]
    const perColor = rule.perNameColor ? resolvePerName(rule.perNameColor) : null;
    const perOpacity = rule.perNameOpacity ? resolvePerName(rule.perNameOpacity) : null;
    const allowed = rule.models ? new Set(rule.models) : null;

    models.forEach((m, idx) => {
      if (m.removed || (allowed !== null && !allowed.has(idx))) {
        return;
      }
      const names = ensureNames(m); // cached (ensureGlobalIndex built them)
      const n = names.length;

      if (appendOnly) {
        // -----------------------------------------------------------------------------
        // FAST PATH — hits arrive pre-resolved per model (global index,
        // O(tags) once per rule), then one top-down flood over the CSR
        // (O(entries)); DEEPEST tag wins (per-level colouring). Every item
        // painted exactly once, no per-entry subtree walk.
        // -----------------------------------------------------------------------------
        const sMatch = acc ? clk() : 0;
        const sel = new Uint8Array(n);
        let all = false;
        for (const { m: mt, level } of matchers) {
          if (!mt) {
            continue;
          }
          if (mt === 'all') {
            all = true;
            break;
          }
          if (level > 0) {
            // folder level: the filter tests the folder NAME — a hit takes
            // every root of this model (whole folder, model by model)
            const folderHit = folderNameHit(m, mt, level);
            if (folderHit !== undefined) {
              if (folderHit) {
                for (const r of m.roots) {
                  sel[r] = 1;
                }
              }
              continue;
            }
            // entry level: match ONLY the names at that depth — the flood
            // below carries each hit down its subtree
            const entryLevel = level - groupSegments(m).length;
            const depth = entryDepths(m);
            if ('byModel' in mt) {
              for (const e of mt.byModel.get(idx) ?? []) {
                if (depth[e] === entryLevel) {
                  sel[e] = 1;
                }
              }
            } else {
              for (let e = 0; e < n; e++) {
                if (depth[e] === entryLevel && mt.fn(names[e])) {
                  sel[e] = 1;
                }
              }
            }
            continue;
          }
          if ('byModel' in mt) {
            for (const e of mt.byModel.get(idx) ?? []) {
              sel[e] = 1;
            }
          } else {
            for (let e = 0; e < n; e++) {
              if (mt.fn(names[e])) {
                sel[e] = 1;
              }
            }
          }
        }
        if (all) {
          sel.fill(1);
        }
        if (acc) {
          acc.match += clk() - sMatch;
        }

        // own per-name values (pre-resolved per model), then flood down
        const sProp = acc ? clk() : 0;
        const col = rule.perNameColor ? new Float64Array(n).fill(NONE) : null;
        const opa = rule.perNameOpacity ? new Int16Array(n).fill(NONE) : null;
        if (col && perColor) {
          for (const [e, c] of perColor.get(idx) ?? []) {
            col[e] = c;
          }
        }
        if (opa && perOpacity) {
          for (const [e, o] of perOpacity.get(idx) ?? []) {
            opa[e] = Math.max(0, Math.min(100, Math.round(o)));
          }
        }
        const order = bfsOrder(m);
        const parent = m.hierarchy.entryParent;
        for (const e of order) {
          const p = parent[e];
          if (p === NO_PARENT) {
            continue;
          }
          if (!sel[e]) {
            sel[e] = sel[p];
          }
          if (col && col[e] === NONE) {
            col[e] = col[p];
          }
          if (opa && opa[e] === NONE) {
            opa[e] = opa[p];
          }
        }
        if (acc) {
          acc.perName += clk() - sProp;
        }

        const sWrite = acc ? clk() : 0;
        const touchedItems: number[] = [];
        for (let i = 0; i < m.itemCount; i++) {
          const e = m.itemToEntry[i];
          if (e !== NO_PARENT && sel[e]) {
            touchedItems.push(i);
          }
        }
        if (!touchedItems.length) {
          if (acc) {
            acc.write += clk() - sWrite;
          }
          return;
        }
        total += touchedItems.length;
        captureOnce(idx);
        for (const it of touchedItems) {
          const e = m.itemToEntry[it];
          const color = col && col[e] !== NONE ? col[e] : rule.colorRGBA8;
          if (color != null && color >= 0) {
            m.states[it * 2] |= HAS_COLOR_OVERRIDE;
            m.states[it * 2 + 1] = color;
          } else {
            m.states[it * 2] &= ~HAS_COLOR_OVERRIDE;
          }
          const opacity = opa && opa[e] !== NONE ? opa[e] : rule.opacityPct;
          if (opacity != null) {
            const v = Math.max(0, Math.min(100, Math.round(opacity)));
            m.states[it * 2] = ((m.states[it * 2] & ~OPACITY_MASK) | HAS_OPACITY_OVERRIDE | (v << OPACITY_SHIFT)) >>> 0;
          } else {
            m.states[it * 2] = (m.states[it * 2] & ~(OPACITY_MASK | HAS_OPACITY_OVERRIDE)) >>> 0;
          }
          if (mode === 'hide') {
            m.states[it * 2] &= ~IS_HIDDEN; // matched = visible
          }
        }
        if (acc) {
          acc.write += clk() - sWrite;
        }
        touched.add(idx);
        return;
      }

      // -----------------------------------------------------------------------------
      // FALLBACK — rules with a `remove` filter: item-level add/delete in
      // filter order (subtree walks). 'names' arrive pre-resolved per model.
      // -----------------------------------------------------------------------------
      const sMatch = acc ? clk() : 0;
      const result = new Set<number>();
      const applyEntry = (e: number, op: 'append' | 'remove') => {
        for (const it of itemsUnder(m, e)) {
          if (op === 'remove') {
            result.delete(it);
          } else {
            result.add(it);
          }
        }
      };
      for (const { op, m: mt, level } of matchers) {
        if (!mt) {
          continue;
        }
        if (mt === 'all') {
          if (op === 'remove') {
            result.clear();
          } else {
            for (let i = 0; i < m.itemCount; i++) {
              result.add(i);
            }
          }
          continue;
        }
        if (level > 0) {
          // folder level: the filter tests the folder NAME (see fast path)
          const folderHit = folderNameHit(m, mt, level);
          if (folderHit !== undefined) {
            if (folderHit) {
              for (const r of m.roots) {
                applyEntry(r, op);
              }
            }
            continue;
          }
          // entry level: match ONLY the names at that depth
          const entryLevel = level - groupSegments(m).length;
          const depth = entryDepths(m);
          if ('byModel' in mt) {
            for (const e of mt.byModel.get(idx) ?? []) {
              if (depth[e] === entryLevel) {
                applyEntry(e, op);
              }
            }
          } else {
            for (let e = 0; e < n; e++) {
              if (depth[e] === entryLevel && mt.fn(names[e])) {
                applyEntry(e, op);
              }
            }
          }
          continue;
        }
        if ('byModel' in mt) {
          for (const e of mt.byModel.get(idx) ?? []) {
            applyEntry(e, op);
          }
        } else {
          for (let e = 0; e < n; e++) {
            if (mt.fn(names[e])) {
              applyEntry(e, op);
            }
          }
        }
      }
      if (acc) {
        acc.match += clk() - sMatch;
      }
      if (!result.size) {
        return;
      }
      const sPerName = acc ? clk() : 0;
      const itemColor = rule.perNameColor ? new Map<number, number>() : null;
      const itemOpacity = rule.perNameOpacity ? new Map<number, number>() : null;
      if (itemColor && perColor) {
        for (const [e, c] of perColor.get(idx) ?? []) {
          for (const it of itemsUnder(m, e)) {
            itemColor.set(it, c);
          }
        }
      }
      if (itemOpacity && perOpacity) {
        for (const [e, o] of perOpacity.get(idx) ?? []) {
          for (const it of itemsUnder(m, e)) {
            itemOpacity.set(it, o);
          }
        }
      }
      if (acc) {
        acc.perName += clk() - sPerName;
      }
      total += result.size;
      const sWrite = acc ? clk() : 0;
      captureOnce(idx);
      for (const it of result) {
        const color = itemColor?.get(it) ?? rule.colorRGBA8;
        if (color != null && color >= 0) {
          m.states[it * 2] |= HAS_COLOR_OVERRIDE;
          m.states[it * 2 + 1] = color;
        } else {
          m.states[it * 2] &= ~HAS_COLOR_OVERRIDE;
        }
        const opacity = itemOpacity?.get(it) ?? rule.opacityPct;
        if (opacity != null) {
          const v = Math.max(0, Math.min(100, Math.round(opacity)));
          m.states[it * 2] = ((m.states[it * 2] & ~OPACITY_MASK) | HAS_OPACITY_OVERRIDE | (v << OPACITY_SHIFT)) >>> 0;
        } else {
          m.states[it * 2] = (m.states[it * 2] & ~(OPACITY_MASK | HAS_OPACITY_OVERRIDE)) >>> 0;
        }
        if (mode === 'hide') {
          m.states[it * 2] &= ~IS_HIDDEN; // matched = visible
        }
      }
      if (acc) {
        acc.write += clk() - sWrite;
      }
      touched.add(idx);
    });
    counts.push(total);
  }
  if (T && acc) {
    T.rows.push({ label: 'worker: names + index build', ms: acc.names });
    T.rows.push({ label: 'worker: match / select (index)', ms: acc.match });
    T.rows.push({ label: 'worker: propagate + per-name', ms: acc.perName });
    T.rows.push({ label: 'worker: state writes', ms: acc.write });
    T.last = performance.now();
  }
  pushColorUndo(undoStep);
  const updates = Array.from(touched, (idx) => packStates(models[idx], idx));
  T?.mark('packStates');
  return { updates, counts, ...(T ? { trace: T.rows } : {}) };
}
