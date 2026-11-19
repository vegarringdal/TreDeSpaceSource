import { describe, expect, it } from 'vitest';
import { openRowTop, revealScrollTop } from '../src/components/panels/viewpoints/openRowLayout';

const ROW_H = 30;

describe('openRowTop — rows of a virtual list with one taller, open row', () => {
  it('stacks rows by the row height when none is open', () => {
    expect(openRowTop(0, ROW_H, -1, 120)).toBe(0);
    expect(openRowTop(7, ROW_H, -1, 120)).toBe(210);
  });

  it('pushes only the rows AFTER the open one down', () => {
    expect(openRowTop(2, ROW_H, 3, 120)).toBe(60);
    expect(openRowTop(3, ROW_H, 3, 120)).toBe(90);
    expect(openRowTop(4, ROW_H, 3, 120)).toBe(240);
  });
});

describe('revealScrollTop — scrolling the open row into view', () => {
  it('leaves the list alone when the row is already in view', () => {
    expect(revealScrollTop(100, 160, 80, 200)).toBe(80);
  });

  it('scrolls up to a row above the fold', () => {
    expect(revealScrollTop(40, 100, 80, 200)).toBe(40);
  });

  it('scrolls down just far enough to show the whole row', () => {
    expect(revealScrollTop(300, 420, 80, 200)).toBe(220);
  });

  it('keeps the top of a row taller than the viewport in view', () => {
    expect(revealScrollTop(300, 900, 80, 200)).toBe(300);
  });
});
