import { describe, expect, it } from 'vitest';
import { computeTooltipPlacement } from '../src/treDeSpaceUI/widgets/tooltipPlacement';

const VIEWPORT = { width: 1200, height: 800 };
const TIP = { width: 260, height: 70 };

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

const overlaps = (
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) =>
  a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

describe('tooltip placement — free-standing anchor', () => {
  it('sits below the anchor, left-aligned, when there is room', () => {
    const anchor = rect(100, 200, 80, 24);
    const p = computeTooltipPlacement(anchor, null, TIP, VIEWPORT);

    expect(p.side).toBe('bottom');
    expect(p.top).toBe(231); // anchor bottom + GAP
    expect(p.left).toBe(100);
  });

  it('flips above when the bubble would fall off the bottom', () => {
    const anchor = rect(100, 760, 80, 24);
    const p = computeTooltipPlacement(anchor, null, TIP, VIEWPORT);

    expect(p.side).toBe('top');
    expect(p.top).toBe(760 - TIP.height - 7);
  });

  it('clamps to the viewport instead of running off the right edge', () => {
    const p = computeTooltipPlacement(rect(1150, 200, 40, 24), null, TIP, VIEWPORT);

    expect(p.left).toBe(VIEWPORT.width - TIP.width - 4);
  });
});

describe('tooltip placement — inside a menu', () => {
  const menu = rect(300, 150, 250, 120);
  const entry = rect(300, 174, 250, 24); // second row of the menu

  it('goes beside the whole menu, never over its entries', () => {
    const p = computeTooltipPlacement(entry, menu, TIP, VIEWPORT);

    expect(p.side).toBe('right');
    expect(p.left).toBe(menu.left + menu.width + 7);
    expect(overlaps({ ...p, ...TIP }, menu)).toBe(false);
  });

  it('is vertically centred on the hovered entry', () => {
    const p = computeTooltipPlacement(entry, menu, TIP, VIEWPORT);

    expect(p.top + TIP.height / 2).toBe(entry.top + entry.height / 2);
  });

  it('swaps to the left when the menu is against the right edge', () => {
    const right = rect(900, 150, 250, 120);
    const p = computeTooltipPlacement(rect(900, 174, 250, 24), right, TIP, VIEWPORT);

    expect(p.side).toBe('left');
    expect(p.left + TIP.width).toBe(right.left - 7);
    expect(overlaps({ ...p, ...TIP }, right)).toBe(false);
  });

  it('falls back to the vertical placement when neither side fits', () => {
    const narrow = { width: 300, height: 800 };
    const wide = rect(10, 150, 280, 120);
    const p = computeTooltipPlacement(rect(10, 174, 280, 24), wide, TIP, narrow);

    expect(p.side === 'bottom' || p.side === 'top').toBe(true);
  });
});

describe('tooltip placement — arrow', () => {
  it('points at the anchor centre along the facing edge', () => {
    const anchor = rect(100, 200, 80, 24);
    const p = computeTooltipPlacement(anchor, null, TIP, VIEWPORT);

    expect(p.left + p.arrow + 4).toBe(anchor.left + anchor.width / 2);
  });

  it('stays inside the bubble when the anchor centre is far off', () => {
    const p = computeTooltipPlacement(rect(1150, 200, 40, 24), null, TIP, VIEWPORT);

    expect(p.arrow).toBeGreaterThanOrEqual(8);
    expect(p.arrow).toBeLessThanOrEqual(TIP.width - 16);
  });
});
