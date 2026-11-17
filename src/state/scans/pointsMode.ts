// When the laser-scan points are streamed and drawn (the "Show points" radio
// of the Scans panel). Pure, so the streamer, the panel and the tests share it.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** 'off': not loaded at all — a scan is then its spheres and photos only.
 *  'hidden': not drawn, but what is loaded stays loaded (back at once).
 *  'always': in the free view and inside a setup. 'entered': only while a
 *  setup is entered — nothing is streamed in the free view. */
export type PointsMode = 'off' | 'hidden' | 'always' | 'entered';

/** A mode that shows points at all. */
export type ShownPointsMode = Exclude<PointsMode, 'off' | 'hidden'>;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Whether points are shown right now: `active` is the entered setup, if any. */
export function arePointsShown(mode: PointsMode, active: string | null): boolean {
  return mode === 'always' || (mode === 'entered' && active !== null);
}

/** Whether a mode shows points at all (in some view). */
export function isShownMode(mode: PointsMode): mode is ShownPointsMode {
  return mode === 'always' || mode === 'entered';
}

/**
 * How long points that are not shown keep their memory, ms: forever while
 * only hidden, not at all when off, and `graceMs` in the free view of
 * "only inside a setup" — stepping out of one setup and into the next should
 * not restream.
 */
export function hiddenKeepMs(mode: PointsMode, graceMs: number): number {
  if (mode === 'hidden') {
    return Number.POSITIVE_INFINITY;
  }

  return mode === 'off' ? 0 : graceMs;
}
