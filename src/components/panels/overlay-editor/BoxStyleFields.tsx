import { BorderInput, BoxSidesInput, NumberInput, SegmentedControl, Select } from '@treDeSpaceUI/widgets';
import type { BoxStyle, Shadow } from '../../../lib/overlay/overlayTypes';
import { ColorTokenField } from './ColorTokenField';

const SHADOWS: readonly { value: Shadow; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

const SIZE_MODES = [
  { value: 'auto', label: 'Auto', tooltip: 'As big as the content' },
  { value: 'fill', label: 'Fill', tooltip: 'All the space the parent gives' },
  { value: 'px', label: 'px', tooltip: 'A fixed size in pixels' },
] as const;

function SizeField({
  label,
  which,
  value,
  onChange,
}: {
  label: string;
  /** which size it is — its hotkeys are overlay.style.<which>.… */
  which: 'width' | 'height';
  value: BoxStyle['width'];
  onChange: (v: BoxStyle['width']) => void;
}) {
  const mode = value === undefined || value === 'auto' ? 'auto' : value === 'fill' ? 'fill' : 'px';
  const options = SIZE_MODES.map((o) => ({ ...o, shortcut: `overlay.style.${which}.${o.value}` }));
  return (
    <div className="flex items-center gap-1">
      <span className="w-16 text-[11px] text-slate-400">{label}</span>
      <SegmentedControl
        size="sm"
        value={mode}
        options={options}
        onChange={(m) => onChange(m === 'px' ? (typeof value === 'number' ? value : 120) : m)}
      />
      {typeof value === 'number' && (
        <NumberInput
          tooltip="Size in px"
          decShortcut={`overlay.style.${which}.dec`}
          incShortcut={`overlay.style.${which}.inc`}
          className="w-20"
          value={value}
          min={0}
          max={4000}
          step={4}
          unit="px"
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** Box-like style: background, opacity, padding, margin, border, radius,
 *  shadow, width, height. */
export function BoxStyleFields({
  style,
  onChange,
  showSize = true,
}: {
  style: BoxStyle;
  onChange: (s: BoxStyle) => void;
  showSize?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <ColorTokenField label="Background" value={style.bg} allowNone onChange={(bg) => onChange({ ...style, bg })} />
      <NumberInput
        tooltip="How opaque the block is (0..1)"
        decShortcut="overlay.style.opacity.dec"
        incShortcut="overlay.style.opacity.inc"
        label="Opacity"
        labelPosition="left"
        labelWidth={64}
        value={style.opacity ?? 1}
        min={0}
        max={1}
        step={0.05}
        onChange={(opacity) => onChange({ ...style, opacity })}
      />
      <BoxSidesInput
        label="Padding"
        labelWidth={64}
        value={style.padding ?? [0, 0, 0, 0]}
        onChange={(padding) => onChange({ ...style, padding })}
      />
      <BoxSidesInput
        label="Margin"
        labelWidth={64}
        min={-400}
        value={style.margin ?? [0, 0, 0, 0]}
        onChange={(margin) => onChange({ ...style, margin })}
      />
      <BorderInput
        value={style.border ?? null}
        onChange={(border) => onChange({ ...style, border: border ?? undefined })}
      />
      {style.border && (
        <ColorTokenField
          label="Border col."
          value={style.border.color}
          onChange={(color) =>
            style.border && onChange({ ...style, border: { ...style.border, color: color ?? '#94a3b8' } })
          }
        />
      )}
      <NumberInput
        tooltip="Rounded corners (px)"
        decShortcut="overlay.style.radius.dec"
        incShortcut="overlay.style.radius.inc"
        label="Radius"
        labelPosition="left"
        labelWidth={64}
        value={style.radius ?? 0}
        min={0}
        max={400}
        step={1}
        unit="px"
        onChange={(radius) => onChange({ ...style, radius })}
      />
      <Select
        tooltip="Drop shadow under the block"
        label="Shadow"
        labelPosition="left"
        labelWidth={64}
        value={style.shadow ?? 'none'}
        options={SHADOWS}
        clearable={false}
        onChange={(shadow) => shadow && onChange({ ...style, shadow })}
      />
      {showSize && (
        <>
          <SizeField
            label="Width"
            which="width"
            value={style.width}
            onChange={(width) => onChange({ ...style, width })}
          />
          <SizeField
            label="Height"
            which="height"
            value={style.height}
            onChange={(height) => onChange({ ...style, height })}
          />
        </>
      )}
    </div>
  );
}
