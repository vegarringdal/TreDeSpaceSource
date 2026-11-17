import { describe, expect, it } from 'vitest';
import { component } from '../src/lib/overlay/overlayParse';
import { PRESET_TITLE } from '../src/lib/overlay/overlayPresets';
import { renderOverlay } from '../src/lib/overlay/overlayTemplate';
import type { BindingContext, OverlayComponent } from '../src/lib/overlay/overlayTypes';

const CTX: BindingContext = { step: null, objectName: null, time: 0, duration: 0 };

/** The sized wrapper's inline style (the template's first value). */
function frameStyle(c: OverlayComponent): string {
  const [style] = renderOverlay(c, {}, null, CTX).values;
  return typeof style === 'string' ? style : '';
}

describe('overlay card size', () => {
  it('scales every text by the instance text size, not the padding', () => {
    const [, ...rest] = renderOverlay(PRESET_TITLE, { title: 'T' }, null, CTX, { textScale: 1.5 }).values;
    const css = JSON.stringify(rest);
    expect(css).toContain('font-size:72px');
    expect(css).not.toContain('font-size:48px');
  });

  it('parses min / max widths, clamped, and leaves them out when absent', () => {
    const raw = { ...PRESET_TITLE, size: { width: 'auto', minWidth: -5, maxWidth: 99999 } };
    expect(component(raw, 'c').size).toEqual({ width: 'auto', height: 'auto', minWidth: 0, maxWidth: 4000 });
    expect(component({ ...PRESET_TITLE, size: { width: 300 } }, 'c').size).toEqual({ width: 300, height: 'auto' });
  });

  it('hugs the content between min and max when auto, and is exact when fixed', () => {
    expect(frameStyle(PRESET_TITLE)).toContain('width:max-content;min-width:360px;max-width:1200px;');
    expect(frameStyle({ ...PRESET_TITLE, size: { width: 'auto', height: 'auto' } })).toContain(
      'min-width:0px;max-width:640px;',
    );
    expect(frameStyle({ ...PRESET_TITLE, size: { width: 'auto', height: 'auto', minWidth: 500, maxWidth: 200 } })).toContain(
      'min-width:500px;max-width:500px;',
    );
    expect(frameStyle({ ...PRESET_TITLE, size: { width: 900, height: 'auto' } })).toContain('width:900px;');
  });
});
