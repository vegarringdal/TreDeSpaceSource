import { describe, expect, it } from 'vitest';
import { addMonths, formatIsoDate, isoWeek, monthGrid, parseIsoDate } from '../src/treDeSpaceUI/widgets/datepicker/dateMath';

describe('parseIsoDate / formatIsoDate', () => {
  it('round-trips valid dates', () => {
    expect(parseIsoDate('2026-08-07')).toEqual({ y: 2026, m: 8, d: 7 });
    expect(formatIsoDate({ y: 2026, m: 8, d: 7 })).toBe('2026-08-07');
  });

  it('rejects malformed and impossible dates', () => {
    expect(parseIsoDate('2026-8-7')).toBeNull();
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it('accepts leap days only in leap years', () => {
    expect(parseIsoDate('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseIsoDate('2026-02-29')).toBeNull();
  });
});

describe('isoWeek', () => {
  // Reference values cross-checked against the ISO 8601 tables: year edges
  // are where naive week math breaks.
  it('handles ordinary mid-year dates', () => {
    expect(isoWeek({ y: 2026, m: 8, d: 7 })).toBe(32);
  });

  it('assigns early January to the previous year’s last week', () => {
    expect(isoWeek({ y: 2027, m: 1, d: 1 })).toBe(53); // Fri → week 53 of 2026
    expect(isoWeek({ y: 2026, m: 1, d: 1 })).toBe(1); // Thu → week 1
    expect(isoWeek({ y: 2022, m: 1, d: 1 })).toBe(52); // Sat → week 52 of 2021
  });

  it('assigns late December to next year’s week 1 when applicable', () => {
    expect(isoWeek({ y: 2025, m: 12, d: 29 })).toBe(1); // Mon of week 1 / 2026
    expect(isoWeek({ y: 2026, m: 12, d: 31 })).toBe(53); // 2026 has 53 weeks
  });
});

describe('monthGrid', () => {
  it('always starts weeks on Monday and spans 6 rows', () => {
    const weeks = monthGrid(2026, 8);
    expect(weeks).toHaveLength(6);
    // August 2026 starts on a Saturday → the first row starts Mon July 27.
    expect(weeks[0].days[0].iso).toBe('2026-07-27');
    expect(weeks[0].days[0].inMonth).toBe(false);
    expect(weeks[0].days[5].iso).toBe('2026-08-01');
    expect(weeks[0].days[5].inMonth).toBe(true);
  });

  it('tags each row with the ISO week of its Thursday', () => {
    const weeks = monthGrid(2026, 1);
    expect(weeks[0].week).toBe(1); // week containing Thu Jan 1 2026
    const dec = monthGrid(2025, 12);
    expect(dec[5].week).toBe(2); // last row reaches into week 2 of 2026
  });
});

describe('addMonths', () => {
  it('carries across year boundaries in both directions', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(addMonths(2026, 6, -18)).toEqual({ y: 2024, m: 12 });
  });
});
