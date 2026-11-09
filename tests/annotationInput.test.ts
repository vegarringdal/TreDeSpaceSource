import { describe, expect, it } from 'vitest';
import { escapeHtml, richTextHtml } from '../src/lib/richText';
import {
  type LabelStyle,
  readLabel,
  readLabelsFile,
  readMeasurements,
  readMeasurementsFile,
} from '../src/state/viewer/annotationInput';

// the payload from the security report: a colour that closes the attribute
// and opens an element with an inline handler
const INJECTED_COLOR = 'red"/><image href=x onerror=alert(document.domain)>';

const STYLE: LabelStyle = {
  bg: '#ffffff',
  opacity: 1,
  textColor: '#14161a',
  leaderColor: '#000000',
  sphere: null,
};

const DEFAULTS = { bg: STYLE.bg, textColor: STYLE.textColor };

const label = (extra: Record<string, unknown>) => ({ text: 'A', anchor: [1, 2, 3], ...extra });

describe('readLabel', () => {
  it('drops an injected leader colour (null = follow the panel)', () => {
    expect(readLabel(label({ leaderColor: INJECTED_COLOR }), DEFAULTS)?.leaderColor).toBeNull();
  });

  it('falls back to the defaults for injected bg / text colours', () => {
    const l = readLabel(label({ bg: INJECTED_COLOR, textColor: 'url(x)' }), DEFAULTS);
    expect(l?.bg).toBe('#ffffff');
    expect(l?.textColor).toBe('#14161a');
  });

  it('keeps valid colours in canonical hex form', () => {
    const l = readLabel(label({ leaderColor: 'Red', bg: '#ABC' }), DEFAULTS);
    expect(l?.leaderColor).toBe('#ff0000');
    expect(l?.bg).toBe('#aabbcc');
  });

  it('resets a non-numeric offset to [0,0] and keeps a numeric one', () => {
    expect(readLabel(label({ offset: ['10"/><script>', 4] }), DEFAULTS)?.offset).toEqual([0, 0]);
    expect(readLabel(label({ offset: [12, -4] }), DEFAULTS)?.offset).toEqual([12, -4]);
  });

  it('drops a label without text or a finite [x,y,z] anchor', () => {
    expect(readLabel({ anchor: [0, 0, 0] }, DEFAULTS)).toBeNull();
    expect(readLabel({ text: 'A', anchor: ['1', 2, 3] }, DEFAULTS)).toBeNull();
    expect(readLabel({ text: 'A', anchor: [1, 2, Number.NaN] }, DEFAULTS)).toBeNull();
    expect(readLabel({ text: 'A', anchor: [1, 2] }, DEFAULTS)).toBeNull();
    expect(readLabel('nope', DEFAULTS)).toBeNull();
  });

  it('clamps opacity, coerces the fullname and never imports a selection', () => {
    const l = readLabel(label({ opacity: 7, fullname: 42, selected: true }), DEFAULTS);
    expect(l?.opacity).toBe(1);
    expect(l?.fullname).toBeNull();
    expect(l?.selected).toBe(false);
  });

  it('only keeps keys a label has', () => {
    const l = readLabel(label({ onclick: 'x', style: 'position:fixed' }), DEFAULTS);
    expect(l && Object.keys(l).sort()).toEqual(
      ['anchor', 'bg', 'fullname', 'id', 'leaderColor', 'offset', 'opacity', 'selected', 'sphere', 'text', 'textColor'].sort(),
    );
  });
});

describe('readLabelsFile', () => {
  it('validates the shared style block and drops unknown keys', () => {
    const file = readLabelsFile(
      {
        items: [label({})],
        muted: 'yes',
        style: { leaderColor: INJECTED_COLOR, opacity: 0.5, richText: true, items: [], placing: true },
      },
      STYLE,
    );
    expect(file.style).toEqual({ ...STYLE, opacity: 0.5 });
    expect(file.muted).toBe(false);
    expect(file.items).toHaveLength(1);
  });

  it('round-trips a file the app saved', () => {
    const saved = {
      items: [label({ offset: [5, 6], leaderColor: '#112233', sphere: { size: 1, color: '#ff0000', solid: true, opacity: 0.5 } })],
      muted: true,
      style: { bg: '#eeeeee', opacity: 0.8, textColor: '#000000', leaderColor: '#ff8800', sphere: null },
    };
    const file = readLabelsFile(saved, STYLE);
    expect(file.muted).toBe(true);
    expect(file.style).toEqual(saved.style);
    expect(file.items[0]).toMatchObject({ offset: [5, 6], leaderColor: '#112233', sphere: saved.items[0].sphere });
  });

  it('treats a non-object file as empty', () => {
    expect(readLabelsFile(null, STYLE)).toEqual({ items: [], muted: false, style: STYLE });
    expect(readLabelsFile({ items: 'x' }, STYLE).items).toEqual([]);
  });
});

const line = (extra: Record<string, unknown>) => ({
  kind: 'line',
  points: [{ pos: [0, 0, 0] }, { pos: [1, 0, 0], normal: [0, 0, 1] }],
  ...extra,
});

describe('readMeasurementsFile', () => {
  it('drops an injected line colour to black', () => {
    expect(readMeasurementsFile({ lineColor: INJECTED_COLOR }).lineColor).toBe('#000000');
    expect(readMeasurementsFile({ lineColor: 'Orange' }).lineColor).toBe('#ffa500');
  });

  it('clamps precision to the stepper range', () => {
    expect(readMeasurementsFile({ precision: 1000 }).precision).toBe(6);
    expect(readMeasurementsFile({ precision: -3 }).precision).toBe(0);
    expect(readMeasurementsFile({ precision: 2.4 }).precision).toBe(2);
    expect(readMeasurementsFile({ precision: '4' }).precision).toBe(3);
  });

  it('drops measurements with an unknown kind or a non-finite point', () => {
    const { items } = readMeasurementsFile({
      items: [
        line({}),
        line({ kind: 'script' }),
        line({ points: [{ pos: ['0', 0, 0] }] }),
        line({ points: [{ pos: [0, 0] }] }),
        line({ points: 'x' }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].points).toEqual([{ pos: [0, 0, 0] }, { pos: [1, 0, 0], normal: [0, 0, 1] }]);
  });

  it('backfills flags and keeps only booleans', () => {
    const [m] = readMeasurementsFile({ items: [line({ label: 7, visible: 'no', axisLegs: [true, 'y', 1] })] }).items;
    expect(m).toMatchObject({
      label: '',
      visible: true,
      showLabel: true,
      showPerp: false,
      axisLegs: [true, false, false],
      axisLabels: [false, false, false],
      sphere: null,
    });
  });
});

describe('readMeasurements ids', () => {
  it('keeps unique positive ids and renumbers missing or repeated ones past the largest', () => {
    const ids = readMeasurements([line({ id: 4 }), line({ id: 4 }), line({}), line({ id: -1 }), line({ id: 2 })]).map(
      (m) => m.id,
    );
    expect(ids).toEqual([4, 5, 6, 7, 2]);
  });
});

describe('escapeHtml', () => {
  it('escapes quotes as well as markup, so attribute use is safe too', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
  });

  it('leaves the rich-text markup working', () => {
    expect(richTextHtml('**"bold"**\nnext')).toBe('<b>&quot;bold&quot;</b><br>next');
  });
});
