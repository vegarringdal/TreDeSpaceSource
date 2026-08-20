import { NumberInput, Select } from '@treDeSpaceUI/widgets';

/** Labelled Select line used by the RVM/IFC option forms. */
export function OptionSelectRow({
  label,
  tooltip,
  shortcut,
  value,
  options,
  onChange,
  labelWidth = 'w-14',
}: {
  label: string;
  tooltip?: string;
  shortcut?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string | null) => void;
  labelWidth?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-slate-400 text-xs" data-shortcut={shortcut} data-tooltip={tooltip}>
      <span className={`${labelWidth} shrink-0`}>{label}</span>
      <Select className="w-full" value={value} options={options} onChange={onChange} />
    </label>
  );
}

/** Labelled NumberInput line used by the RVM/STEP option forms. */
export function OptionNumberRow({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  unit,
  shortcutBase,
  onChange,
  labelWidth = 'w-14',
}: {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Renders `<base>.dec` / `<base>.inc` stepper shortcuts. */
  shortcutBase: string;
  onChange: (v: number) => void;
  labelWidth?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-slate-400 text-xs" data-tooltip={tooltip}>
      <span className={`${labelWidth} shrink-0`}>{label}</span>
      <div className="w-24">
        <NumberInput
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          decShortcut={`${shortcutBase}.dec`}
          incShortcut={`${shortcutBase}.inc`}
        />
      </div>
      {unit != null && <span className="text-slate-500">{unit}</span>}
    </label>
  );
}

/** Labelled checkbox line used by the import option forms. */
export function OptionCheckRow({
  label,
  tooltip,
  shortcut,
  checked,
  onChange,
}: {
  label: string;
  tooltip: string;
  shortcut?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
      data-shortcut={shortcut}
      data-tooltip={tooltip}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
