// Per-filter "collapsed" flags of a filters editor — UI state that travels
// with a filter through move / remove and is never part of the ReportDef (so
// it reaches neither a saved report nor a host reading the draft). A flat
// boolean[] parallel to `filters`; a missing entry reads as expanded, so the
// array may be shorter than the filter list after an external draft change.

export type FilterCollapse = readonly boolean[];

/** What a filters block needs from whoever owns the draft: the flags and the
 *  three ways to change them. */
export type FilterCollapseControls = Readonly<{
  collapsed: FilterCollapse;
  toggle: (i: number) => void;
  expandAll: () => void;
  collapseAll: () => void;
}>;

export function isFilterCollapsed(c: FilterCollapse, i: number): boolean {
  return c[i] === true;
}

/** Flip filter `i`, padding the flags with "expanded" up to it. */
export function toggleFilterCollapsed(c: FilterCollapse, i: number): boolean[] {
  const out = padCollapse(c, i + 1);
  out[i] = !out[i];
  return out;
}

export function setAllFiltersCollapsed(count: number, collapsed: boolean): boolean[] {
  return new Array<boolean>(count).fill(collapsed);
}

/** Mirror of moveReportFilter: the flags of `i` and `i + dir` swap when both
 *  are inside the `count` filters, else nothing changes. */
export function moveFilterCollapsed(c: FilterCollapse, i: number, dir: -1 | 1, count: number): FilterCollapse {
  const j = i + dir;
  if (i < 0 || i >= count || j < 0 || j >= count) {
    return c;
  }
  const out = padCollapse(c, Math.max(i, j) + 1);
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Mirror of removeReportFilter. */
export function removeFilterCollapsed(c: FilterCollapse, i: number): boolean[] {
  return c.filter((_, k) => k !== i);
}

function padCollapse(c: FilterCollapse, len: number): boolean[] {
  const out = [...c];
  while (out.length < len) {
    out.push(false);
  }
  return out;
}
