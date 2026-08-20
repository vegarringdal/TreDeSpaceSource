import { DatePicker, type DateRange } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for DatePicker. */
export function DatePickerDemo() {
  const [date, setDate] = useState<string | null>(null);
  const [bounded, setBounded] = useState<string | null>('2026-08-20');
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  return (
    <Section
      title="DatePicker"
      note="A compact calendar field: Monday-first weeks with ISO week numbers, month/year quick-jump behind the header label. The value is an ISO yyyy-mm-dd string (never a Date object), so timezones cannot shift days. min/max bound the pickable range. With `range`, the first click picks the start, the second the end (auto-swapped if backwards) and hovering previews the span."
      props={['DatePickerProps', 'SingleDatePickerProps', 'RangeDatePickerProps']}
      code={`function Deadlines() {
  const [date, setDate] = useState<string | null>(null);
  const [range, setRange] =
    useState<DateRange>({ start: null, end: null });
  return (
    <>
      <DatePicker value={date} onChange={setDate} />
      <DatePicker range value={range} onChange={setRange} />
    </>
  );
}`}
    >
      <label className="mb-1 block text-slate-400 text-xs">Any date — {date ?? 'nothing picked'}</label>
      <DatePicker className="max-w-56" value={date} onChange={setDate} />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Bounded to 2026-08-10 … 2026-09-15</label>
      <DatePicker className="max-w-56" min="2026-08-10" max="2026-09-15" value={bounded} onChange={setBounded} />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Range — click start, then end</label>
      <DatePicker range className="max-w-72" value={range} onChange={setRange} />
    </Section>
  );
}
