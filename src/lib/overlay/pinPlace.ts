import type { Pin } from './overlayTypes';

/** Room left between a pinned card and the edge of the view (a fraction of
 *  the view), so a card pinned to a corner does not touch it. */
export const PIN_PAD = 0.01;

/** Where a screen overlay pinned at `pin` goes: that corner, edge middle or
 *  the centre of the view, `pad` in from the edges (0..1, y down). */
export function pinPlace(pin: Pin, pad = PIN_PAD): [number, number] {
  const x = pin.includes('l') ? pad : pin.includes('r') ? 1 - pad : 0.5;
  const y = pin.startsWith('t') ? pad : pin.startsWith('b') ? 1 - pad : 0.5;
  return [x, y];
}
