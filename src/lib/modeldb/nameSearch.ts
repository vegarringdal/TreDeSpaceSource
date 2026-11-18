// Hierarchy-panel name search: import folders and entry names across every
// live model, shallowest level first, optionally one row per distinct name.
import { models, NO_PARENT } from './dbState';
import { ensureNames, entryDepths, entryName } from './hierarchyIndex';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type NameMatchMode = 'contains' | 'equals';

/** One search row. `model === -1` with `group` set is an import folder.
 *  `count` (distinct search only) = how many entries carry this name. */
export type SearchHit = {
  model: number;
  entry: number;
  name: string;
  path: number[];
  depth: number;
  group?: string;
  count?: number;
};

type NameMatcher = (nameLower: string) => boolean;

type Candidate = { model: number; entry: number; depth: number };

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Enough candidates (or distinct names) to pick the shallowest `limit` from. */
const SCAN_CAP = 5000;
const MIN_QUERY_LEN = 2;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Build the case-insensitive matcher. `equals` takes * wildcards at the ends:
 *  "*86A" ends-with, "86A*" starts-with, "*86A*" contains, plain = exact.
 *  Null when the query is too short to search. */
function buildMatcher(text: string, mode: NameMatchMode): NameMatcher | null {
  const raw = text.trim().toLowerCase();
  if (raw.replaceAll('*', '').length < MIN_QUERY_LEN) {
    return null;
  }
  if (mode === 'contains') {
    return (n) => n.includes(raw);
  }
  const startsWild = raw.startsWith('*');
  const endsWild = raw.endsWith('*');
  const q = raw.replace(/^\*+|\*+$/g, '');
  if (startsWild && endsWild) {
    return (n) => n.includes(q);
  }
  if (startsWild) {
    return (n) => n.endsWith(q);
  }
  if (endsWild) {
    return (n) => n.startsWith(q);
  }
  return (n) => n === q;
}

/** Every path level of every live model's import folder that matches —
 *  "TP000" finds the TP000-ELECTRO folder as well as items named that way. */
function matchFolders(matches: NameMatcher): SearchHit[] {
  const groupPaths = new Set<string>();
  for (const m of models) {
    if (m.removed) {
      continue;
    }
    let p = '';
    for (const seg of m.group.split('/')) {
      p = p ? `${p}/${seg}` : seg;
      groupPaths.add(p);
    }
  }
  const out: SearchHit[] = [];
  for (const p of groupPaths) {
    const seg = p.split('/').pop() ?? p;
    if (matches(seg.toLowerCase()) || matches(p.toLowerCase())) {
      out.push({ model: -1, entry: -1, name: p, path: [], depth: 0, group: p });
    }
  }
  return out;
}

function rootPath(model: number, entry: number): number[] {
  const parent = models[model].hierarchy.entryParent;
  const path: number[] = [];
  for (let p = entry; p !== NO_PARENT; p = parent[p]) {
    path.unshift(p);
  }
  return path;
}

function toHit(c: Candidate, count: number | undefined): SearchHit {
  const name = entryName(models[c.model], c.entry);
  const hit: SearchHit = { model: c.model, entry: c.entry, name, path: rootPath(c.model, c.entry), depth: c.depth };
  return count === undefined ? hit : { ...hit, count };
}

/** Matching entries until SCAN_CAP. Tombstoned (unloaded) slots keep their
 *  hierarchy for a possible revive but never surface. */
function matchEntries(matches: NameMatcher, cap: number): Candidate[] {
  const out: Candidate[] = [];
  for (let mi = 0; mi < models.length && out.length < cap; mi++) {
    const m = models[mi];
    if (m.removed) {
      continue;
    }
    const namesLower = ensureNames(m);
    const depths = entryDepths(m);
    for (let e = 0; e < namesLower.length && out.length < cap; e++) {
      if (matches(namesLower[e])) {
        out.push({ model: mi, entry: e, depth: depths[e] });
      }
    }
  }
  return out;
}

/** One candidate per case-insensitive name — its shallowest entry, the first
 *  model / entry on a tie — with how many live entries carry the name. The
 *  scan is complete so every count is exact; only the number of DISTINCT
 *  names is capped (names past the cap are left out, like plain search). */
function matchDistinctNames(matches: NameMatcher, cap: number): { rep: Candidate; count: number }[] {
  const byName = new Map<string, { rep: Candidate; count: number }>();
  for (let mi = 0; mi < models.length; mi++) {
    const m = models[mi];
    if (m.removed) {
      continue;
    }
    const namesLower = ensureNames(m);
    const depths = entryDepths(m);
    for (let e = 0; e < namesLower.length; e++) {
      const n = namesLower[e];
      if (!matches(n)) {
        continue;
      }
      const seen = byName.get(n);
      if (seen) {
        seen.count++;
        if (depths[e] < seen.rep.depth) {
          seen.rep = { model: mi, entry: e, depth: depths[e] };
        }
        continue;
      }
      if (byName.size < cap) {
        byName.set(n, { rep: { model: mi, entry: e, depth: depths[e] }, count: 1 });
      }
    }
  }
  return [...byName.values()];
}

const byDepthThenName = (a: SearchHit, b: SearchHit): number => a.depth - b.depth || a.name.localeCompare(b.name);

/** Case-insensitive name search over import folders and live entries, sorted
 *  shallowest-first (highest hierarchy level wins), then by name, capped at
 *  `limit`. `distinct` collapses entries sharing a name into one row (its
 *  shallowest occurrence, with `count`) BEFORE the cap, so ten copies of one
 *  name never crowd out the other matches. */
export function searchNames(text: string, mode: NameMatchMode, limit: number, distinct: boolean): SearchHit[] {
  const matches = buildMatcher(text, mode);
  if (!matches) {
    return [];
  }
  const entries: { rep: Candidate; count?: number }[] = distinct
    ? matchDistinctNames(matches, SCAN_CAP)
    : matchEntries(matches, SCAN_CAP).map((rep) => ({ rep }));
  // sorted and capped BEFORE the root paths are built, so only the rows that
  // survive pay for their walk up the tree
  const named = entries.map((e) => ({ ...e, name: entryName(models[e.rep.model], e.rep.entry) }));
  named.sort((a, b) => a.rep.depth - b.rep.depth || a.name.localeCompare(b.name));
  const entryHits = named.slice(0, limit).map(({ rep, count }) => toHit(rep, count));
  return [...matchFolders(matches), ...entryHits].sort(byDepthThenName).slice(0, limit);
}
