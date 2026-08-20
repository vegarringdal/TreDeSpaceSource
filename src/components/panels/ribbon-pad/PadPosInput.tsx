import { NumberInput, RibbonSlot } from '@treDeSpaceUI/widgets';

type PadPosInputProps = Readonly<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  decShortcut: string;
  incShortcut: string;
}>;

/** One joystick-position field: caption stacked OVER the number input, as its
 *  own ribbon column. */
export function PadPosInput({ label, value, onChange, decShortcut, incShortcut }: PadPosInputProps) {
  return (
    <RibbonSlot size="big" className="w-28">
      <div className="flex w-full flex-col gap-0.5">
        <span className="whitespace-nowrap pl-0.5 text-[10px] text-slate-400 leading-none">{label}</span>
        <NumberInput
          value={value}
          min={0}
          max={100}
          step={2}
          precision={0}
          unit="%"
          decShortcut={decShortcut}
          incShortcut={incShortcut}
          onChange={onChange}
        />
      </div>
    </RibbonSlot>
  );
}
