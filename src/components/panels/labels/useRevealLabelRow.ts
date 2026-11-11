import { type RefObject, useEffect, useRef } from 'react';
import type { LabelsState } from '../../../state/viewer/labels.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type RevealLabelRow = Readonly<{
  /** Attach to the list's own scroller; rows carry `data-label-id`. */
  scrollerRef: RefObject<HTMLDivElement | null>;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const FLASH_MS = 1200;
const FLASH_KEYFRAMES: Keyframe[] = [{ backgroundColor: 'rgb(59 130 246 / 0.35)' }, { backgroundColor: 'transparent' }];

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Centre `row` in `scroller` when it is not fully visible. Scrolls only the
 *  list itself — `scrollIntoView` would also scroll the dock's clipped
 *  (overflow-hidden) containers and shift the layout. */
function scrollRowIntoView(scroller: HTMLElement, row: HTMLElement): void {
  const box = scroller.getBoundingClientRect();
  const at = row.getBoundingClientRect();
  if (at.top >= box.top && at.bottom <= box.bottom) {
    return;
  }

  scroller.scrollBy({ top: at.top - box.top - (box.height - at.height) / 2, behavior: 'smooth' });
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

/** Labels list: scroll to the row of the label last clicked in the viewport
 *  and flash it, so it is easy to find. Runs per request (and once on mount,
 *  so opening the panel lands on the last clicked label). */
export function useRevealLabelRow(reveal: LabelsState['reveal']): RevealLabelRow {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!reveal || !scroller) {
      return;
    }

    const row = scroller.querySelector<HTMLElement>(`[data-label-id="${reveal.id}"]`);
    if (!row) {
      return;
    }

    scrollRowIntoView(scroller, row);
    row.animate(FLASH_KEYFRAMES, { duration: FLASH_MS, easing: 'ease-out' });
  }, [reveal]);

  return { scrollerRef };
}
