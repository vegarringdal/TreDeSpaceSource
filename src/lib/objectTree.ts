// -----------------------------------------------------------------------------
// objects that ride on each other
// -----------------------------------------------------------------------------
// Transform objects and animation objects both have an optional `parent` (the
// id of the object they ride on). These walk that tree. A parent that is
// missing, or a loop, counts as no parent everywhere. Pure.

/** Anything with an id and an optional parent id. */
export interface TreeNode {
  id: string;
  parent?: string;
}

/** Whether `id` rides on `ancestor` (through any number of parents). */
export function ridesOn(objects: readonly TreeNode[], id: string, ancestor: string): boolean {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  for (let at = byId.get(id)?.parent; at && !seen.has(at); at = byId.get(at)?.parent) {
    if (at === ancestor) {
      return true;
    }
    seen.add(at);
  }
  return false;
}

/** The object `o` rides on, when it is in `objects` and does not ride on `o`
 *  itself (a loop). */
export function parentIn<T extends TreeNode>(objects: readonly T[], o: TreeNode): T | undefined {
  if (!o.parent || o.parent === o.id) {
    return undefined;
  }
  const parent = objects.find((x) => x.id === o.parent);
  return parent && !ridesOn(objects, parent.id, o.id) ? parent : undefined;
}

/** The objects in tree order — each parent right before what rides on it —
 *  with their depth (a top-level object is 0). */
export function treeOrder<T extends TreeNode>(objects: readonly T[]): { object: T; depth: number }[] {
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const o of objects) {
    const parent = parentIn(objects, o);
    if (parent) {
      kids.set(parent.id, [...(kids.get(parent.id) ?? []), o]);
    } else {
      roots.push(o);
    }
  }
  const out: { object: T; depth: number }[] = [];
  const walk = (o: T, depth: number) => {
    out.push({ object: o, depth });
    for (const k of kids.get(o.id) ?? []) {
      walk(k, depth + 1);
    }
  };
  for (const r of roots) {
    walk(r, 0);
  }
  return out;
}

/** The objects with everything that rides on one placed BEFORE it, the order
 *  otherwise kept — where "the first object naming an item keeps it", this
 *  lets a sub-object keep its items from the object it rides on. */
export function ridersFirst<T extends TreeNode>(objects: readonly T[]): T[] {
  const order = treeOrder(objects);
  const out: T[] = [];
  const emit = (i: number): number => {
    const { object, depth } = order[i];
    let next = i + 1;
    while (next < order.length && order[next].depth > depth) {
      next = emit(next);
    }
    out.push(object);
    return next;
  };
  for (let i = 0; i < order.length; ) {
    i = emit(i);
  }
  return out;
}

/** `ids` without those riding on another of them: what a move applies to
 *  when a container and its sub-objects are picked together (the
 *  sub-objects ride along). */
export function withoutRiders(objects: readonly TreeNode[], ids: readonly string[]): string[] {
  return ids.filter((id) => !ids.some((other) => other !== id && ridesOn(objects, id, other)));
}

/** Every object riding on `id`, through any number of parents. */
export function ridersOf<T extends TreeNode>(objects: readonly T[], id: string): T[] {
  return objects.filter((o) => ridesOn(objects, o.id, id));
}
