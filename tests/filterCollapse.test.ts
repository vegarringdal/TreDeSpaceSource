import { describe, expect, it } from 'vitest';
import {
  isFilterCollapsed,
  moveFilterCollapsed,
  removeFilterCollapsed,
  setAllFiltersCollapsed,
  toggleFilterCollapsed,
} from '../src/state/sqlReports/filterCollapse';

describe('filterCollapse helpers', () => {
  it('missing entries read as expanded; toggle pads and flips', () => {
    expect(isFilterCollapsed([], 3)).toBe(false);
    const c = toggleFilterCollapsed([], 2);
    expect(c).toEqual([false, false, true]);
    expect(isFilterCollapsed(c, 2)).toBe(true);
    expect(toggleFilterCollapsed(c, 2)).toEqual([false, false, false]);
  });

  it('set all / remove', () => {
    expect(setAllFiltersCollapsed(3, true)).toEqual([true, true, true]);
    expect(setAllFiltersCollapsed(0, true)).toEqual([]);
    expect(removeFilterCollapsed([true, false, true], 1)).toEqual([true, true]);
  });

  it('move follows the filter, ignores moves off either end, never mutates', () => {
    const c = [true, false, false];
    expect(moveFilterCollapsed(c, 0, 1, 3)).toEqual([false, true, false]);
    expect(moveFilterCollapsed(c, 0, -1, 3)).toBe(c);
    expect(moveFilterCollapsed(c, 2, 1, 3)).toBe(c);
    expect(moveFilterCollapsed([true], 0, 1, 2)).toEqual([false, true]); // shorter than the list: pads first
    expect(c).toEqual([true, false, false]);
  });
});
