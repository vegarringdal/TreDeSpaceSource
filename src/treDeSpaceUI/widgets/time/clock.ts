// The "m:ss.s" clock of TimeInput — pure, so it unit-tests directly.

/** "m:ss.s" → seconds. Accepts "75", "1:15", "1:15.5"; anything else is null. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(\d+):(\d{1,2}(?:\.\d*)?)$/.exec(t);
  if (m) {
    return Number(m[1]) * 60 + Number(m[2]);
  }
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
}

/** Seconds → "m:ss.s" (negatives clamp to 0). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/**
 * The seconds a typed clock commits, or null for none: text that does not
 * parse, or the text the field already shows for `value` — focus passing
 * through (Tab, a click elsewhere) must not round the value to the clock's
 * 0.1 s.
 */
export function clockCommit(text: string, value: number): number | null {
  return text.trim() === formatClock(value) ? null : parseClock(text);
}
