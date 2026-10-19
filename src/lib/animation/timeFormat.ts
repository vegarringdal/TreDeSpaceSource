/** mm:ss.s — the player's and timeline's time read-out. */
export function formatTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const m = Math.floor(tenths / 600);
  const rest = (tenths - m * 600) / 10;
  return `${String(m).padStart(2, '0')}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** "4.0s" — a duration chip. */
export function formatDuration(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(1)}s`;
}
