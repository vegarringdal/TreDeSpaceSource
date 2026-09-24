// The MultiColor rule engine: resolves each rule's filter rows to an item set
// and writes color/opacity overrides directly on those items. Split out of
// apiColor — the selection-based override actions live there; the shared
// STATE undo stack lives in colorUndo.

import * as Comlink from 'comlink';
import { PACKED_NO_COLOR, PACKED_NO_OPACITY, type PackedNames, packedName } from '../color/packedNames';
import { type ColorUndoRecord, captureColorRuns, pushColorUndo } from './colorUndo';
import {
  type DbModel,
  HAS_COLOR_OVERRIDE,
  HAS_OPACITY_OVERRIDE,
  IS_HIDDEN,
  models,
  NO_PARENT,
  OPACITY_MASK,
  opacityHides,
  type StateUpdate,
  withOpacityOverride,
} from './dbState';
import { ensureGlobalIndex, hitEntry, hitModel, liveHits } from './globalNameIndex';
import { bfsOrder, ensureNames, entryDepths, itemsUnder, packStates, updateBuffers } from './hierarchyIndex';

/** Escape a literal string for embedding in a RegExp (wildcard compile). */
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every override bit a `reset` run clears first — color, opacity band and
 *  hidden — identical to the Alt+R / "Clear all" slate. */
const RESET_MASK = (HAS_COLOR_OVERRIDE | HAS_OPACITY_OVERRIDE | OPACITY_MASK | IS_HIDDEN) >>> 0;

/** The model's import-folder path segments (tree-panel top levels). */
function groupSegments(m: DbModel): string[] {
  return m.group.split('/').filter((s) => s.length > 0);
}

/** One MultiColor rule, resolved UI-side into plain data for the worker. */
export interface ColorRuleSpec {
  filters: {
    /** append = add the row's matches to the rule's result, remove =
     *  subtract them, keep = intersect (only what the rows above found that
     *  this row matches too) — in row order */
    op: 'append' | 'remove' | 'keep';
    /** contains | single (equals, * at start/end) | starts | ends |
     *  wildcard (equals, * anywhere) | multi (one name per line) |
     *  packed (a PackedNames buffer set in `packed`; `value` unused) */
    mode: 'contains' | 'single' | 'multi' | 'starts' | 'ends' | 'wildcard' | 'packed';
    value: string;
    /** `packed` mode: the flat fullname list with per-row color/opacity — a
     *  big SQL result. Semantically one Multi filter + perNameColor /
     *  perNameOpacity, without any of it existing as strings or Records. */
    packed?: PackedNames;
    /** Hierarchy level the filter is applied TO: the row matches only the
     *  NAMES at that level, and each match includes its whole subtree.
     *  Levels count like the tree panel — import-folder segments included,
     *  so 1 = top folder (the filter tests the folder name; a hit takes
     *  every model under it) and the model's root entries sit at
     *  folderDepth+1. 0/omitted = match at any level — the folder names
     *  included, so a folder hit takes everything under it. */
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
 * its filter rows (append = union, remove = subtract, keep = intersect — in
 * order;
 * a matched entry colors its whole subtree, like selection) and then writes
 * color / opacity overrides directly on those items — the current selection
 * is untouched. Mode: `reset` clears every override first (color, opacity
 * and hidden — the same slate as Alt+R / "Clear all"), `append` layers
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
  //             keeps the names that are folder segments for the folder tests
  //   fn      → contains/equals wildcard: must scan entries
  type PerName = Map<number, [number, number][]>;
  /** `folders`: the row's names that are an import-folder segment somewhere
   *  (tiny — never the whole list); a packed row keeps those names' own
   *  colour/opacity beside them. */
  type NamesMatcher = {
    byModel: Map<number, number[]>;
    folders: Set<string>;
    perColor?: PerName;
    perOpacity?: PerName;
    folderColor?: Map<string, number>;
    folderOpacity?: Map<string, number>;
  };
  type Matcher = 'all' | NamesMatcher | { fn: (n: string) => boolean } | null;
  /** Union per-model [entry, value] lists (packed filters add theirs to the
   *  rule's perNameColor/perNameOpacity). Later entries win in the flood. */
  const mergePerName = (into: PerName | null, add: PerName | undefined): PerName | null => {
    if (!add) {
      return into;
    }
    if (!into) {
      return add;
    }
    for (const [mi, list] of add) {
      const cur = into.get(mi);
      if (!cur) {
        into.set(mi, list);
        continue;
      }
      for (const pair of list) {
        cur.push(pair);
      }
    }
    return into;
  };
  // every import-folder segment of the live models (lowercased): the per-name
  // modes keep just these of their names for the folder tests
  const folderNames = new Set<string>();
  models.forEach((m) => {
    if (!m.removed) {
      for (const seg of groupSegments(m)) {
        folderNames.add(seg.toLowerCase());
      }
    }
  });
  /** A packed list: decode each name ONCE, straight into per-model entry
   *  lists (+ per-row color/opacity) — nothing per row is kept, except the
   *  names that are folder segments (with their row's colour/opacity). */
  const packedMatcher = (p: PackedNames): Matcher => {
    if (!p.count) {
      return null;
    }
    const byModel = new Map<number, number[]>();
    const perColor: PerName = new Map();
    const perOpacity: PerName = new Map();
    const folders = new Set<string>();
    const folderColor = new Map<string, number>();
    const folderOpacity = new Map<string, number>();
    const decoder = new TextDecoder();
    for (let i = 0; i < p.count; i++) {
      const name = packedName(p, i, decoder);
      const c = p.colors[i];
      const o = p.opacity[i];
      if (folderNames.has(name)) {
        folders.add(name);
        if (c !== PACKED_NO_COLOR) {
          folderColor.set(name, c);
        }
        if (o !== PACKED_NO_OPACITY) {
          folderOpacity.set(name, o);
        }
      }
      liveHits(name, (h) => {
        const mi = hitModel(h);
        const e = hitEntry(h);
        const list = byModel.get(mi);
        if (list) {
          list.push(e);
        } else {
          byModel.set(mi, [e]);
        }
        if (c !== PACKED_NO_COLOR) {
          const l = perColor.get(mi);
          if (l) {
            l.push([e, c]);
          } else {
            perColor.set(mi, [[e, c]]);
          }
        }
        if (o !== PACKED_NO_OPACITY) {
          const l = perOpacity.get(mi);
          if (l) {
            l.push([e, o]);
          } else {
            perOpacity.set(mi, [[e, o]]);
          }
        }
      });
    }
    return { byModel, folders, perColor, perOpacity, folderColor, folderOpacity };
  };
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
  /** The entries of a per-fullname record whose name is an import-folder
   *  segment — those never resolve to an entry; the folder hits use them. */
  const folderValues = (rec: Record<string, number> | undefined): Map<string, number> => {
    const out = new Map<string, number>();
    if (!rec) {
      return out;
    }
    for (const [name, value] of Object.entries(rec)) {
      if (folderNames.has(name)) {
        out.set(name, value);
      }
    }
    return out;
  };
  const rowMatcher = (row: ColorRuleSpec['filters'][number]): Matcher => {
    if (row.mode === 'packed') {
      return row.packed ? packedMatcher(row.packed) : null;
    }
    if (row.mode === 'multi') {
      const names = row.value
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 0);
      if (!names.length) {
        return null;
      }
      return { byModel: resolveNames(names), folders: new Set(names.filter((n) => folderNames.has(n))) };
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
    // RESET MODEL: the same slate as Alt+R / "Clear all" — color, opacity
    // AND hidden overrides all go, so a run always starts from the bare model
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      const items: number[] = [];
      for (let i = 0; i < m.itemCount; i++) {
        if (m.states[i * 2] & RESET_MASK) {
          items.push(i);
        }
      }
      if (!items.length) {
        return;
      }
      captureOnce(idx);
      for (const i of items) {
        m.states[i * 2] = (m.states[i * 2] & ~RESET_MASK) >>> 0;
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
    /** A row against one model's FOLDER segments — the import folders are
     *  part of the search, and a folder hit takes the whole model. At a level
     *  the row tests the folder NAME at that level only (undefined = the
     *  level is below the folders → entry matching); at level 0 any folder
     *  of the path, deepest first. Returns the hit segment, null for none. */
    const folderHit = (m: DbModel, mt: Exclude<Matcher, 'all' | null>, level: number): string | null | undefined => {
      const segs = groupSegments(m);
      if (level > segs.length) {
        return undefined;
      }
      const test = (seg: string): boolean => ('byModel' in mt ? mt.folders.has(seg) : mt.fn(seg));
      if (level > 0) {
        const seg = segs[level - 1].toLowerCase();
        return test(seg) ? seg : null;
      }
      for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i].toLowerCase();
        if (test(seg)) {
          return seg;
        }
      }
      return null;
    };
    /** The per-name value of the deepest folder the rule hit on a model (a
     *  folder's own row outranks its parent folder's, like entries). */
    const folderValueOf = (m: DbModel, hit: Set<string>, values: Map<string, number>): number | undefined => {
      if (!hit.size || !values.size) {
        return undefined;
      }
      const segs = groupSegments(m);
      for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i].toLowerCase();
        if (hit.has(seg)) {
          const v = values.get(seg);
          if (v !== undefined) {
            return v;
          }
        }
      }
      return undefined;
    };
    // per-name colour/opacity resolved ONCE globally → per-model [entry, value];
    // packed filters bring theirs pre-resolved. A value on a FOLDER name (a
    // Multi line "folder<TAB>red") is kept by name for the folder hits.
    let perColor = rule.perNameColor ? resolvePerName(rule.perNameColor) : null;
    let perOpacity = rule.perNameOpacity ? resolvePerName(rule.perNameOpacity) : null;
    const folderColor = folderValues(rule.perNameColor);
    const folderOpacity = folderValues(rule.perNameOpacity);
    for (const { m: mt } of matchers) {
      if (mt && mt !== 'all' && 'byModel' in mt) {
        perColor = mergePerName(perColor, mt.perColor);
        perOpacity = mergePerName(perOpacity, mt.perOpacity);
        for (const [name, c] of mt.folderColor ?? []) {
          folderColor.set(name, c);
        }
        for (const [name, o] of mt.folderOpacity ?? []) {
          folderOpacity.set(name, o);
        }
      }
    }
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
        const hitFolders = new Set<string>();
        let all = false;
        for (const { m: mt, level } of matchers) {
          if (!mt) {
            continue;
          }
          if (mt === 'all') {
            all = true;
            break;
          }
          // the import folders are part of the search: a folder hit takes
          // every root of this model (whole folder, model by model) — the
          // flood below carries it down
          const seg = folderHit(m, mt, level);
          if (seg) {
            for (const r of m.roots) {
              sel[r] = 1;
            }
            hitFolders.add(seg);
          }
          if (level > 0) {
            if (seg !== undefined) {
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
        const col = perColor || folderColor.size ? new Float64Array(n).fill(NONE) : null;
        const opa = perOpacity || folderOpacity.size ? new Int16Array(n).fill(NONE) : null;
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
        // a hit folder's own colour/opacity lands on the roots (a root's own
        // per-name value, set above, still wins) and floods down with them
        const fc = folderValueOf(m, hitFolders, folderColor);
        if (col && fc !== undefined) {
          for (const r of m.roots) {
            if (col[r] === NONE) {
              col[r] = fc;
            }
          }
        }
        const fo = folderValueOf(m, hitFolders, folderOpacity);
        if (opa && fo !== undefined) {
          for (const r of m.roots) {
            if (opa[r] === NONE) {
              opa[r] = Math.max(0, Math.min(100, Math.round(fo)));
            }
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
            m.states[it * 2] = withOpacityOverride(m.states[it * 2], opacity);
          } else {
            m.states[it * 2] = (m.states[it * 2] & ~(OPACITY_MASK | HAS_OPACITY_OVERRIDE)) >>> 0;
          }
          // A rule run REPLACES what the previous one did, so a match that is
          // not an explicit opacity 0 is meant to be seen: clear a hide an
          // earlier run left behind (a rule moved off 0 must bring its items
          // back). Note the Set editor sends a fully opaque rule as no opacity
          // at all, so `null` has to unhide too. This is also how `hide` mode
          // unhides what it matches — one rule covers both.
          if (!(opacity != null && opacityHides(opacity))) {
            m.states[it * 2] &= ~IS_HIDDEN;
          }
        }
        if (acc) {
          acc.write += clk() - sWrite;
        }
        touched.add(idx);
        return;
      }

      // -----------------------------------------------------------------------------
      // FALLBACK — rules with a `remove` / `keep` filter: item-level set ops
      // in filter order (subtree walks). 'names' arrive pre-resolved per model.
      // -----------------------------------------------------------------------------
      const sMatch = acc ? clk() : 0;
      const result = new Set<number>();
      const hitFolders = new Set<string>();
      /** Every entry one row hits in this model — the folders first (see the
       *  fast path), then the entries at the row's level or at any level.
       *  Returns the hit folder segment, if any. */
      const matchRow = (mt: Exclude<Matcher, 'all' | null>, level: number, hit: (e: number) => void): string | null => {
        const seg = folderHit(m, mt, level);
        if (seg) {
          for (const r of m.roots) {
            hit(r);
          }
        }
        if (level > 0) {
          if (seg !== undefined) {
            return seg;
          }
          // entry level: match ONLY the names at that depth
          const entryLevel = level - groupSegments(m).length;
          const depth = entryDepths(m);
          if ('byModel' in mt) {
            for (const e of mt.byModel.get(idx) ?? []) {
              if (depth[e] === entryLevel) {
                hit(e);
              }
            }
          } else {
            for (let e = 0; e < n; e++) {
              if (depth[e] === entryLevel && mt.fn(names[e])) {
                hit(e);
              }
            }
          }
          return null;
        }
        if ('byModel' in mt) {
          for (const e of mt.byModel.get(idx) ?? []) {
            hit(e);
          }
        } else {
          for (let e = 0; e < n; e++) {
            if (mt.fn(names[e])) {
              hit(e);
            }
          }
        }
        return seg ?? null;
      };
      for (const { op, m: mt, level } of matchers) {
        if (!mt) {
          continue;
        }
        if (mt === 'all') {
          // blank filter: append takes every item, remove drops them all,
          // keep changes nothing
          if (op === 'remove') {
            result.clear();
          } else if (op === 'append') {
            for (let i = 0; i < m.itemCount; i++) {
              result.add(i);
            }
          }
          continue;
        }
        // keep = intersect: the row's hits are collected on their own, and
        // the result is cut down to them once the row is matched
        const keep = op === 'keep' ? new Set<number>() : null;
        const target = keep ?? result;
        const seg = matchRow(mt, level, (e) => {
          for (const it of itemsUnder(m, e)) {
            if (op === 'remove') {
              result.delete(it);
            } else {
              target.add(it);
            }
          }
        });
        if (seg && op !== 'remove') {
          hitFolders.add(seg);
        }
        if (keep) {
          for (const it of result) {
            if (!keep.has(it)) {
              result.delete(it);
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
      // a hit folder's own colour/opacity is the model-wide default under
      // the entries' per-name values (deepest wins)
      const fc = folderValueOf(m, hitFolders, folderColor);
      const fo = folderValueOf(m, hitFolders, folderOpacity);
      const itemColor = perColor ? new Map<number, number>() : null;
      const itemOpacity = perOpacity ? new Map<number, number>() : null;
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
        const color = itemColor?.get(it) ?? fc ?? rule.colorRGBA8;
        if (color != null && color >= 0) {
          m.states[it * 2] |= HAS_COLOR_OVERRIDE;
          m.states[it * 2 + 1] = color;
        } else {
          m.states[it * 2] &= ~HAS_COLOR_OVERRIDE;
        }
        const opacity = itemOpacity?.get(it) ?? fo ?? rule.opacityPct;
        if (opacity != null) {
          m.states[it * 2] = withOpacityOverride(m.states[it * 2], opacity);
        } else {
          m.states[it * 2] = (m.states[it * 2] & ~(OPACITY_MASK | HAS_OPACITY_OVERRIDE)) >>> 0;
        }
        // A rule run REPLACES what the previous one did, so a match that is
        // not an explicit opacity 0 is meant to be seen: clear a hide an
        // earlier run left behind (a rule moved off 0 must bring its items
        // back). Note the Set editor sends a fully opaque rule as no opacity
        // at all, so `null` has to unhide too. This is also how `hide` mode
        // unhides what it matches — one rule covers both.
        if (!(opacity != null && opacityHides(opacity))) {
          m.states[it * 2] &= ~IS_HIDDEN;
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
  return Comlink.transfer({ updates, counts, ...(T ? { trace: T.rows } : {}) }, updateBuffers(updates));
}
