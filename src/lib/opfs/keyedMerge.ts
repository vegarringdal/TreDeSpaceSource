// Three-way merges for the JSON libraries several tabs share (the asset
// index, the store registry, the overlay library). Pure — no store or OPFS
// imports — so it is unit-tested.

/** Whether two records hold the same data. */
function sameRecord<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge this tab's list into the one on disk, record by record.
 *
 * `base` is the list as this tab last read or wrote it, so `mine` against
 * `base` is exactly what this tab did since: only those changes are applied
 * to `theirs`. A record this tab added or edited wins over the disk copy; a
 * record this tab removed stays removed; everything this tab left alone comes
 * from `theirs`, including records another tab added, edited or removed. An
 * edit never brings back a record another tab deleted, because its files are
 * gone.
 *
 * The result keeps this tab's order and appends the records it did not have.
 */
export function mergeKeyed<T>(
  base: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  keyOf: (value: T) => string,
): T[] {
  const baseBy = new Map(base.map((v) => [keyOf(v), v]));
  const theirsBy = new Map(theirs.map((v) => [keyOf(v), v]));
  const mineKeys = new Set<string>();
  const merged: T[] = [];

  for (const value of mine) {
    const key = keyOf(value);
    mineKeys.add(key);
    const before = baseBy.get(key);
    const theirValue = theirsBy.get(key);
    if (before === undefined) {
      merged.push(value);
      continue;
    }

    if (theirValue === undefined) {
      continue;
    }

    merged.push(sameRecord(before, value) ? theirValue : value);
  }

  for (const value of theirs) {
    const key = keyOf(value);
    if (!mineKeys.has(key) && !baseBy.has(key)) {
      merged.push(value);
    }
  }

  return merged;
}

const GROUP_SEPARATOR = '\u0000';

function flattenGroups(groups: Readonly<Record<string, readonly string[]>>): string[] {
  return Object.entries(groups).flatMap(([group, values]) => values.map((v) => `${group}${GROUP_SEPARATOR}${v}`));
}

/**
 * {@link mergeKeyed} for a record of string lists (per-store folder paths):
 * each `group + value` pair is one record. Groups left without values are
 * dropped.
 */
export function mergeGroupedStrings(
  base: Readonly<Record<string, readonly string[]>>,
  mine: Readonly<Record<string, readonly string[]>>,
  theirs: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const flat = mergeKeyed(flattenGroups(base), flattenGroups(mine), flattenGroups(theirs), (v) => v);
  const merged: Record<string, string[]> = {};
  for (const entry of flat) {
    const at = entry.indexOf(GROUP_SEPARATOR);
    const group = entry.slice(0, at);
    merged[group] = [...(merged[group] ?? []), entry.slice(at + 1)];
  }

  return merged;
}
