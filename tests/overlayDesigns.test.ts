import { describe, expect, it } from 'vitest';
import { parseOverlayComponent } from '../src/lib/overlay/overlayParse';
import { labelTextKey } from '../src/lib/overlay/overlayBindings';
import { parseOverlayFile, sameOverlay, serializeOverlayFile } from '../src/lib/overlay/overlayFile';
import { PRESET_CALLOUT, PRESET_STEP_CARD } from '../src/lib/overlay/overlayPresets';
import { resolveColor } from '../src/lib/overlay/overlaySafety';
import { overlayUnknownKeys } from '../src/lib/overlay/overlaySchema';
import { fontSize } from '../src/lib/overlay/overlayStyle';
import { renderOverlay } from '../src/lib/overlay/overlayTemplate';
import type { BindingContext, OverlayComponent, OverlayTheme } from '../src/lib/overlay/overlayTypes';

const ctx: BindingContext = { step: null, objectName: null, time: 0, duration: 0 };

/** A small design whose title size and colour are values. */
const design = (): OverlayComponent => ({
  id: 'custom.card',
  name: 'Mine',
  version: 1,
  params: [
    { key: 'title', label: 'Title', type: 'text', default: 'Hi' },
    { key: 'titleSize', label: 'Title size', type: 'number', default: 22 },
    { key: 'ink', label: 'Ink', type: 'color', default: '#00ff00' },
  ],
  size: { width: 'auto', height: 'auto' },
  designHeight: 1080,
  textScale: 2,
  root: {
    kind: 'box',
    id: 'root',
    style: { bg: '$bg', border: { width: 1, color: '{{ink}}', style: 'solid' } },
    layout: { dir: 'col', gap: 4, align: 'stretch', justify: 'start' },
    children: [{ kind: 'text', id: 't', style: { size: '{{titleSize}}', color: '{{ink}}' }, text: '{{title}}', rich: false }],
  },
});

const theme: OverlayTheme = { id: 'custom.brand', name: 'Brand', tokens: { bg: '#102a43', accent: '#f0b429' } };

/** Every string a lit template interpolates (the inline styles among them). */
function strings(v: unknown): string[] {
  if (typeof v === 'string') {
    return [v];
  }
  if (Array.isArray(v)) {
    return v.flatMap(strings);
  }
  if (v && typeof v === 'object' && 'values' in v) {
    return strings(v.values);
  }
  return [];
}

describe('overlay designs', () => {
  it('resolves styles bound to values, falling back when a value is unsafe', () => {
    const tokens = { accent: '#38bdf8', '{{ink}}': '#ff0000', '{{bad}}': 'red;}', '{{tok}}': '$accent', '{{loop}}': '{{ink}}' };
    expect(resolveColor('{{ink}}', tokens, 'fb')).toBe('#ff0000');
    expect(resolveColor('{{bad}}', tokens, 'fb')).toBe('fb');
    expect(resolveColor('{{tok}}', tokens, 'fb')).toBe('#38bdf8');
    expect(resolveColor('{{loop}}', tokens, 'fb')).toBe('fb');
    expect(resolveColor('{{missing}}', tokens, 'fb')).toBe('fb');
    expect(fontSize({ size: '{{s}}' }, { '{{s}}': '30' })).toBe(30);
    expect(fontSize({ size: '{{s}}' }, {})).toBe(16);
    expect(fontSize({ size: 12 }, {})).toBe(12);
  });

  it('renders a card with its own font size and colour, times the design and card text size', () => {
    const css = strings(renderOverlay(design(), { titleSize: 30, ink: '#ff0000' }, null, ctx, { textScale: 1.5 })).join('|');
    expect(css).toContain('font-size:90px');
    expect(css).toContain('color:#ff0000');
    expect(css).toContain('solid #ff0000');
    const byDefault = strings(renderOverlay(design(), {}, theme, ctx)).join('|');
    expect(byDefault).toContain('font-size:44px');
    expect(byDefault).toContain('color:#00ff00');
    expect(byDefault).toContain('background:#102a43');
  });

  it('parses bound styles and the design text size, and refuses what is not a colour or value', () => {
    const ok = parseOverlayComponent(design(), 'c');
    expect(ok.error).toBeUndefined();
    expect(ok.component).toEqual(design());
    const bad = design();
    bad.root = { ...bad.root, style: { bg: 'url(x)' } };
    expect(parseOverlayComponent(bad, 'components[0]').error).toContain('components[0].root.style.bg');
  });

  it('writes and reads overlay files, refusing built-in ids with their path', () => {
    const text = serializeOverlayFile({ components: [design()], themes: [theme] });
    const back = parseOverlayFile(text);
    expect(back.error).toBeUndefined();
    expect(back.data?.components).toEqual([design()]);
    expect(back.data?.themes).toEqual([theme]);
    const builtIn = parseOverlayFile(JSON.stringify({ components: [PRESET_STEP_CARD], themes: [{ ...theme, id: 'theme.light' }] }));
    expect(builtIn.error?.msg).toContain('components[0].id');
    expect(builtIn.error?.msg).toContain('themes[0].id');
    expect(parseOverlayFile(JSON.stringify({ components: [] })).error?.msg).toContain('no designs');
  });

  it('tells the same design apart from a changed one, whatever its version or key order', () => {
    const a = design();
    const reordered: OverlayComponent = { root: a.root, size: a.size, params: a.params, designHeight: 1080, textScale: 2, version: 7, name: a.name, id: a.id };
    expect(sameOverlay(a, reordered)).toBe(true);
    expect(sameOverlay(a, { ...a, name: 'Other' })).toBe(false);
  });

  it('reports fields a design file has that the parser drops', () => {
    const raw = JSON.parse(serializeOverlayFile({ components: [design()], themes: [theme] }));
    raw.components[0].root.children[0].style.colour = '#fff';
    raw.components[0].colour = 1;
    raw.themes[0].colours = {};
    expect(overlayUnknownKeys(raw)).toEqual([
      'components[0].colour: not a design field — ignored',
      'components[0].root.children[0].style.colour: not a design field — ignored',
      'themes[0].colours: not a design field — ignored',
    ]);
  });

  it('finds where a label’s text goes', () => {
    expect(labelTextKey(PRESET_CALLOUT)).toBe('title');
    expect(labelTextKey({ ...design(), params: [{ key: 'name', label: 'N', type: 'text', default: '' }] })).toBe('name');
    expect(labelTextKey({ ...design(), params: [] })).toBeNull();
  });
});
