import { TimePicker, type TimeRange } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for TimePicker. */
export function TimePickerDemo() {
  const [time, setTime] = useState<string | null>(null);
  const [coarse, setCoarse] = useState<string | null>('09:30');
  const [shift, setShift] = useState<TimeRange>({ start: null, end: null });
  return (
    <Section
      title="TimePicker"
      note="A 24-hour time field with an Android-style analog clock: pick the hour on the dual-ring dial (1–12 outer, 00/13–23 inner), it advances to the minute dial, and picking a minute closes. Drag or click the dial; the HH:MM digits switch dials. The value is a 'HH:MM' string. With `range`, the flow chains start → end (an end before the start means the range crosses midnight)."
      props={['TimePickerProps', 'SingleTimePickerProps', 'RangeTimePickerProps']}
      code={`function Shifts() {
  const [time, setTime] = useState<string | null>(null);
  const [shift, setShift] =
    useState<TimeRange>({ start: null, end: null });
  return (
    <>
      <TimePicker value={time} onChange={setTime} />
      <TimePicker range minuteStep={5}
        value={shift} onChange={setShift} />
    </>
  );
}`}
    >
      <label className="mb-1 block text-slate-400 text-xs">Exact minute — {time ?? 'nothing picked'}</label>
      <TimePicker className="max-w-56" value={time} onChange={setTime} />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Snapped to 5 minutes</label>
      <TimePicker className="max-w-56" minuteStep={5} value={coarse} onChange={setCoarse} />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Range — start then end, overnight allowed</label>
      <TimePicker range className="max-w-72" minuteStep={5} value={shift} onChange={setShift} />
    </Section>
  );
}
