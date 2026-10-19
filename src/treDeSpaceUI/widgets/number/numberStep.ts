// The arithmetic of a number field's steps — pure, so it unit-tests directly.

/** The number typed into a field ("1,5" reads as 1.5), or NaN. */
export function parseTyped(text: string): number {
  return parseFloat(text.replace(',', '.'));
}

/**
 * One step (↑ / ↓, the wheel, − / +) from what the field shows: the typed
 * number while it is being edited, else `value`. While editing, the text
 * follows the step — left alone, the old text would be committed again on
 * blur and undo the step.
 */
export function stepField(
  text: string | null,
  value: number,
  delta: number,
  clamp: (v: number) => number,
  decimals: number,
): { value: number; text: string | null } {
  const typed = text == null ? Number.NaN : parseTyped(text);
  const next = clamp((Number.isNaN(typed) ? value : typed) + delta);
  return { value: next, text: text == null ? null : next.toFixed(decimals) };
}
