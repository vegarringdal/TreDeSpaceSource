import { NumberInput, SegmentedControl, Select } from '@treDeSpaceUI/widgets';
import { VALUE_REF_RE } from '../../../lib/overlay/overlaySafety';
import { DEFAULT_TEXT_SIZE } from '../../../lib/overlay/overlayStyle';
import type { FontFamily, TextStyle } from '../../../lib/overlay/overlayTypes';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { ColorTokenField } from './ColorTokenField';

const WEIGHTS = [
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
] as const;

const ALIGN = [
  { value: 'left', label: 'Left', tooltip: 'Align the text left', shortcut: 'overlay.text.align.left' },
  { value: 'center', label: 'Centre', tooltip: 'Centre the text', shortcut: 'overlay.text.align.center' },
  { value: 'right', label: 'Right', tooltip: 'Align the text right', shortcut: 'overlay.text.align.right' },
] as const;

const FONTS: readonly { value: FontFamily; label: string; hint: string }[] = [
  { value: 'ui', label: 'Interface', hint: 'system sans-serif' },
  { value: 'mono', label: 'Monospace', hint: 'system mono' },
  { value: 'serif', label: 'Serif', hint: 'system serif' },
];

const toWeight = (v: string): TextStyle['weight'] => (v === '700' ? 700 : v === '600' ? 600 : v === '500' ? 500 : 400);

const FIXED = '';

/** Text style: colour, size (fixed, or from one of the design's number
 *  values), weight, align, font (system stacks only — they survive capture),
 *  line height, max lines. */
export function TextStyleFields({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const params = overlayEditorState.useSelect((s) => s.working?.params);
  const numbers = (params ?? []).filter((p) => p.type === 'number');
  const bound = typeof style.size === 'string' && VALUE_REF_RE.test(style.size) ? style.size : null;
  const sizeFrom = [
    { value: FIXED, label: 'Fixed size' },
    ...numbers.map((p) => ({ value: `{{${p.key}}}`, label: `Value: ${p.label || p.key}` })),
  ];

  return (
    <div className="flex flex-col gap-1">
      <ColorTokenField
        label="Colour"
        value={style.color ?? '$text'}
        onChange={(color) => onChange({ ...style, color })}
      />
      <div className="flex items-center gap-1">
        {bound === null && (
          <NumberInput
            tooltip="Font size (px at the design height)"
            decShortcut="overlay.text.size.dec"
            incShortcut="overlay.text.size.inc"
            className="min-w-0 flex-1"
            label="Size"
            labelPosition="left"
            labelWidth={64}
            value={typeof style.size === 'number' ? style.size : DEFAULT_TEXT_SIZE}
            min={4}
            max={400}
            step={1}
            unit="px"
            onChange={(size) => onChange({ ...style, size })}
          />
        )}
        {(numbers.length > 0 || bound !== null) && (
          <Select
            tooltip="Take the size from one of the design's number values, so every card using it sets its own (add one under Parameters)"
            className={bound === null ? 'w-32' : 'min-w-0 flex-1'}
            label={bound === null ? undefined : 'Size'}
            labelPosition="left"
            labelWidth={64}
            value={bound ?? FIXED}
            options={sizeFrom}
            clearable={false}
            onChange={(v) => onChange({ ...style, size: v ? v : DEFAULT_TEXT_SIZE })}
          />
        )}
      </div>
      <Select
        tooltip="How bold the text is"
        label="Weight"
        labelPosition="left"
        labelWidth={64}
        value={String(style.weight ?? 400)}
        options={WEIGHTS}
        clearable={false}
        onChange={(w) => w && onChange({ ...style, weight: toWeight(w) })}
      />
      <div className="flex items-center gap-1">
        <span className="w-16 text-[11px] text-slate-400">Align</span>
        <SegmentedControl
          size="sm"
          value={style.align ?? 'left'}
          options={ALIGN}
          onChange={(align) => onChange({ ...style, align })}
        />
      </div>
      <Select
        tooltip="Font family"
        label="Font"
        labelPosition="left"
        labelWidth={64}
        value={style.font ?? 'ui'}
        options={FONTS}
        clearable={false}
        onChange={(font) => font && onChange({ ...style, font })}
      />
      <NumberInput
        tooltip="Space between lines (× font size)"
        decShortcut="overlay.text.lineHeight.dec"
        incShortcut="overlay.text.lineHeight.inc"
        label="Line height"
        labelPosition="left"
        labelWidth={64}
        value={style.lineHeight ?? 1.3}
        min={0.5}
        max={4}
        step={0.05}
        onChange={(lineHeight) => onChange({ ...style, lineHeight })}
      />
      <NumberInput
        tooltip="Cut the text after this many lines (0 = no limit)"
        decShortcut="overlay.text.maxLines.dec"
        incShortcut="overlay.text.maxLines.inc"
        label="Max lines"
        labelPosition="left"
        labelWidth={64}
        value={style.maxLines ?? 0}
        min={0}
        max={50}
        step={1}
        onChange={(maxLines) => onChange({ ...style, maxLines: maxLines || undefined })}
      />
    </div>
  );
}
