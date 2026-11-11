// Label text size: the panel default, the range every input clamps to, and
// the reader for untrusted values. Pure (no store imports) so vitest and the
// annotation-input parsers can use it.

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Text size (CSS px) of a label that carries none — every label before the
 *  setting existed, and the panel's default for new ones. */
export const LABEL_FONT_PX = 12;
export const LABEL_FONT_MIN = 6;
export const LABEL_FONT_MAX = 72;

/** Line height as a multiple of the text size (snapshot rendering). */
export const LABEL_LINE_HEIGHT = 1.25;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Whole px, inside the stepper's range. */
export function clampLabelFontSize(px: number): number {
  return Math.min(LABEL_FONT_MAX, Math.max(LABEL_FONT_MIN, Math.round(px)));
}

/** A text size from an untrusted file: a finite number is clamped, anything
 *  else falls back. */
export function readLabelFontSize(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }

  return clampLabelFontSize(raw);
}
