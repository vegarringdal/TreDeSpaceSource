import { describe, expect, it } from 'vitest';
import { PRESET_CALLOUT } from '../src/lib/overlay/overlayPresets';
import { renderOverlay } from '../src/lib/overlay/overlayTemplate';
import type { BindingContext, OverlayBlock, OverlayComponent } from '../src/lib/overlay/overlayTypes';

const CTX: BindingContext = { step: null, objectName: null, time: 0, duration: 0 };

/** The callout with its body text aligned, inside a column or a row box. */
function callout(align: 'left' | 'center' | 'right' | undefined, dir: 'col' | 'row'): OverlayComponent {
  const root = PRESET_CALLOUT.root;
  if (root.kind !== 'box') {
    throw new Error('callout root is a box');
  }
  const children: OverlayBlock[] = root.children.map((b) =>
    b.kind === 'text' && b.id === 'body' ? { ...b, style: { ...b.style, align } } : b,
  );
  return { ...PRESET_CALLOUT, root: { ...root, layout: { ...root.layout, dir }, children } };
}

const css = (c: OverlayComponent) => JSON.stringify(renderOverlay(c, { body: 'x' }, null, CTX).values);

describe('overlay text alignment', () => {
  it('gives an aligned text the column width, or the free room in a row', () => {
    const col = css(callout('center', 'col'));
    expect(col).toContain('text-align:center;');
    expect(col).toContain('align-self:stretch;');
    const row = css(callout('right', 'row'));
    expect(row).toContain('text-align:right;');
    expect(row).toContain('flex:1 1 auto;');
  });

  it('leaves an unaligned text as wide as its words', () => {
    const out = css(callout(undefined, 'col'));
    expect(out).not.toContain('align-self:stretch');
    expect(out).not.toContain('flex:1 1 auto');
  });
});
