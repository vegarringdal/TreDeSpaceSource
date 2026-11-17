import { describe, expect, it } from 'vitest';
import {
  formatClock,
  isShown,
  listPlaceholders,
  makeResolver,
  progressValue,
  soleParam,
  substitute,
} from '../src/lib/overlay/overlayBindings';
import { isSafeColor, isSafeImage, OVERLAY_IMAGE_MAX_BYTES, resolveColor } from '../src/lib/overlay/overlaySafety';
import type { BindingContext, OverlayComponent } from '../src/lib/overlay/overlayTypes';

const LAYOUT = { dir: 'col' as const, gap: 0, align: 'start' as const, justify: 'start' as const };

const COMPONENT: OverlayComponent = {
  id: 'card',
  name: 'Card',
  version: 1,
  params: [
    { key: 'title', label: 'Title', type: 'text', default: 'Untitled' },
    { key: 'show', label: 'Show', type: 'toggle', default: true },
  ],
  root: {
    kind: 'box',
    id: 'root',
    style: {},
    layout: LAYOUT,
    children: [
      { kind: 'text', id: 't', style: {}, text: '{{title}} — {{step.index}} {{bogus}}', rich: false, showIf: 'show' },
      { kind: 'progress', id: 'p', style: {}, value: '{{part.index}}/{{step.count}}' },
    ],
  },
  size: { width: 'auto', height: 'auto' },
  designHeight: 1080,
};

const CTX: BindingContext = {
  step: { name: 'Pump', text: 'Lift it', index: 2, count: 5 },
  objectName: 'PUMP-101',
  time: 65.4,
  duration: 120,
};

describe('overlay placeholders', () => {
  it('resolves params (value, else default) before context, unknown to empty', () => {
    const res = makeResolver(COMPONENT, {}, CTX);
    expect(substitute('{{ title }}: {{step.name}} {{step.index}}/{{step.count}}{{nope}}', res)).toBe(
      'Untitled: Pump 2/5',
    );
    // the older part.* / actor.* names still read the step and the object
    expect(substitute('{{part.name}} {{part.description}} {{part.index}} {{actor.name}}', res)).toBe(
      'Pump Lift it 2 PUMP-101',
    );
    expect(substitute('{{title}}', makeResolver(COMPONENT, { title: 'Hi' }, CTX))).toBe('Hi');
  });

  it('expands placeholders inside a value once, never recursively', () => {
    const res = makeResolver(COMPONENT, { title: 'Step {{step.index}} {{title}}' }, CTX);
    expect(substitute('{{title}}', res)).toBe('Step 2 Step {{step.index}} {{title}}');
  });

  it('formats time placeholders as m:ss.s', () => {
    expect(formatClock(65.4)).toBe('1:05.4');
    expect(formatClock(-3)).toBe('0:00.0');
    expect(substitute('{{time}} / {{duration}}', makeResolver(COMPONENT, {}, CTX))).toBe('1:05.4 / 2:00.0');
  });

  it('finds the sole param of a text bound to exactly one placeholder', () => {
    expect(soleParam(' {{title}} ')).toBe('title');
    expect(soleParam('{{title}}!')).toBeNull();
    expect(soleParam('{{step.name}}')).toBeNull();
  });

  it('hides a block whose showIf toggle is off or text empty', () => {
    const block = { kind: 'divider' as const, id: 'd', style: {}, showIf: 'show' };
    expect(isShown(block, makeResolver(COMPONENT, {}, CTX))).toBe(true);
    expect(isShown(block, makeResolver(COMPONENT, { show: false }, CTX))).toBe(false);
    expect(isShown({ ...block, showIf: 'title' }, makeResolver(COMPONENT, { title: '' }, CTX))).toBe(false);
  });

  it('parses progress values and clamps them to 0..1', () => {
    expect(progressValue('0.4')).toBeCloseTo(0.4);
    expect(progressValue('40%')).toBeCloseTo(0.4);
    expect(progressValue('2 / 5')).toBeCloseTo(0.4);
    expect(progressValue('3')).toBe(1);
    expect(progressValue('1/0')).toBe(0);
    expect(progressValue('abc')).toBe(0);
  });

  it('lists every placeholder and flags the unknown ones', () => {
    expect(listPlaceholders(COMPONENT)).toEqual([
      { key: 'show', known: true },
      { key: 'title', known: true },
      { key: 'step.index', known: true },
      { key: 'bogus', known: false },
      { key: 'part.index', known: true },
      { key: 'step.count', known: true },
    ]);
  });
});

describe('overlay safety', () => {
  it('accepts only hex, plain rgb(), transparent and $tokens as colours', () => {
    for (const c of ['#abc', '#aabbccdd', 'rgb(1, 2, 3)', 'rgba(10,20,30,0.5)', 'transparent', '$accent']) {
      expect(isSafeColor(c)).toBe(true);
    }
    for (const c of ['red', '#abcde', 'url(x)', 'rgb(1,2,3);background:url(x)', 'var(--x)', '$']) {
      expect(isSafeColor(c)).toBe(false);
    }
  });

  it('resolves tokens one level deep and falls back on anything unsafe', () => {
    const tokens = { accent: '#123456', loop: '$accent', bad: 'url(x)' };
    expect(resolveColor('$accent', tokens, '#000')).toBe('#123456');
    expect(resolveColor('$loop', tokens, '#000')).toBe('#000');
    expect(resolveColor('$bad', tokens, '#000')).toBe('#000');
    expect(resolveColor('$missing', tokens, '#000')).toBe('#000');
    expect(resolveColor('javascript:1', tokens, '#000')).toBe('#000');
    expect(resolveColor(undefined, tokens, '#000')).toBe('#000');
  });

  it('accepts only small data: images of the four allowed types', () => {
    expect(isSafeImage('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImage('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')).toBe(true);
    expect(isSafeImage('data:image/gif;base64,R0lGOD==')).toBe(false);
    expect(isSafeImage('https://example.com/a.png')).toBe(false);
    expect(isSafeImage('data:image/png;base64,<script>')).toBe(false);
    const big = 'A'.repeat(Math.ceil((OVERLAY_IMAGE_MAX_BYTES * 4) / 3) + 8);
    expect(isSafeImage(`data:image/png;base64,${big}`)).toBe(false);
  });
});
