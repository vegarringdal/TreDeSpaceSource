import { db } from './db';

/** An item set by name: nodes to add (with what is under them) and nodes
 *  left out, lower-cased fullnames — what animation objects and transform
 *  objects store. */
export interface NamedItemSet {
  name: string;
  items: string[];
  exclude: string[];
}

/**
 * An item set said the shortest way. Nodes picked or added one by one — or a
 * large node with a few parts deselected, which the worker names as every
 * node still wholly selected — are often dozens of names; when one group
 * holds them all but a few nodes, the set is that group with those left out
 * instead. Taken only when it is shorter and names exactly as many items
 * (the same name in another loaded model would widen it); `group` is then
 * the group's display name, else null.
 */
export async function tidyItemSet(
  items: string[],
  exclude: string[] = [],
): Promise<{ items: string[]; exclude: string[]; group: string | null }> {
  const asIs = { items, exclude, group: null };
  if (items.length < 2 && exclude.length === 0) {
    return asIs;
  }
  const group = await db.animClosestGroup(items, exclude);
  if (!group) {
    return asIs;
  }
  const [before, after] = await db.animCountItems([
    { actor: 'before', fullnames: items, exclude },
    { actor: 'after', fullnames: [group.group], exclude: group.minus },
  ]);
  if (before.items !== after.items) {
    return asIs;
  }

  return { items: [group.group], exclude: group.minus, group: group.name };
}

/** A selection (the worker's name for it and its nodes) as a named item set,
 *  said the shortest way and then named after the group. */
export async function shortestItemSet(sel: { name: string; fullnames: string[] }): Promise<NamedItemSet> {
  const tidy = await tidyItemSet(sel.fullnames);

  return { name: tidy.group ?? sel.name, items: tidy.items, exclude: tidy.exclude };
}
