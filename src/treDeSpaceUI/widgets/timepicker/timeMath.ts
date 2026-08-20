// Time-of-day helpers shared by TimePicker and DateTimePicker. Times cross
// the widget APIs as 24-hour `"HH:MM"` strings.

export type Time = Readonly<{ h: number; m: number }>;

/** Parse `"HH:MM"` (24 h); null when malformed or out of range. */
export function parseTime(value: string | null | undefined): Time | null {
  const match = value != null ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  if (!match) {
    return null;
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

export function formatTime(t: Time): string {
  return `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
}

/** The current local time (the one place local time is read). */
export function nowTime(): Time {
  const n = new Date();
  return { h: n.getHours(), m: n.getMinutes() };
}
