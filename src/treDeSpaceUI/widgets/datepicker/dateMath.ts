// Calendar math for DatePicker. Dates cross the widget API as ISO
// `yyyy-mm-dd` strings; internally days are UTC timestamps so a DST change
// can never shift a day.

export type DateParts = Readonly<{ y: number; m: number; d: number }>;

const DAY_MS = 86_400_000;

/** Parse `yyyy-mm-dd`; null when malformed or not a real calendar day. */
export function parseIsoDate(iso: string | null | undefined): DateParts | null {
  if (!iso) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function formatIsoDate(p: DateParts): string {
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${pad(p.y, 4)}-${pad(p.m, 2)}-${pad(p.d, 2)}`;
}

/** Today in the user's local timezone (the one place local time is read). */
export function todayParts(): DateParts {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
}

/**
 * ISO 8601 week number, 1–53. Weeks start Monday; week 1 is the week
 * containing the year's first Thursday (equivalently, the one containing
 * January 4th), so edge days can belong to week 52/53 of the previous year
 * or week 1 of the next.
 */
export function isoWeek(p: DateParts): number {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // this day's Thursday
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

export type GridDay = Readonly<{ parts: DateParts; iso: string; inMonth: boolean }>;
export type GridWeek = Readonly<{ week: number; days: readonly GridDay[] }>;

/**
 * The 6 Monday-first weeks covering month `m` of year `y` (fixed 6 rows so
 * the calendar never changes height), each row tagged with its ISO week
 * number; leading/trailing days of the neighbour months are marked.
 */
export function monthGrid(y: number, m: number): readonly GridWeek[] {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // neighbour-month days before the 1st
  const start = first.getTime() - lead * DAY_MS;
  const weeks: GridWeek[] = [];
  for (let w = 0; w < 6; w++) {
    const days: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      const t = new Date(start + (w * 7 + i) * DAY_MS);
      const parts = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
      days.push({ parts, iso: formatIsoDate(parts), inMonth: parts.m === m && parts.y === y });
    }
    weeks.push({ week: isoWeek(days[3].parts), days }); // index 3 = the row's Thursday
  }
  return weeks;
}

/** Month arithmetic that carries across year boundaries. */
export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const i = y * 12 + (m - 1) + delta;
  return { y: Math.floor(i / 12), m: (((i % 12) + 12) % 12) + 1 };
}
