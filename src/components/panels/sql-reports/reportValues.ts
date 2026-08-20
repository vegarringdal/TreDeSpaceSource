import type { ReportFilter } from '../../../state/sqlReports/sqlReports.state';

/** One row of a COLORING result, ready to hand to the color actions. */
export type ColorRow = { fullname: string; color: string };

// -----------------------------------------------------------------------------
// run-time filter values
// -----------------------------------------------------------------------------

/** Filter values are user-typed per key; guard their shape instead of trusting it. */
export const stringOr = (v: unknown, fallback: string | undefined): string | undefined =>
  typeof v === 'string' ? v : fallback;

/** Filter values are user-typed per key; guard their shape instead of trusting it. */
export const stringsOr = (v: unknown, fallback: string[] | undefined): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback;

/** Initial run-time values for a report's filters, from their saved defaults. */
export function seedVals(filters: ReportFilter[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const f of filters) {
    out[f.key] = f.kind === 'INPUT' ? (f.value ?? '') : (f.selected ?? []);
  }
  return out;
}
