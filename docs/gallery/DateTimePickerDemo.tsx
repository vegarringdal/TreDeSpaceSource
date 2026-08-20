import { DateTimePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for DateTimePicker. */
export function DateTimePickerDemo() {
  const [moment, setMoment] = useState<string | null>(null);
  return (
    <Section
      title="DateTimePicker"
      note="Date + time in one field: the calendar picks the day, then the popover advances to the 24-hour clock (hour → minute → done); the header buttons re-enter either part. The value is an ISO local 'yyyy-mm-ddTHH:MM' string — no timezone, sorts correctly as plain text."
      props={['DateTimePickerProps']}
      code={`function Milestone() {
  const [moment, setMoment] = useState<string | null>(null);
  return <DateTimePicker value={moment} onChange={setMoment} />;
}`}
    >
      <label className="mb-1 block text-slate-400 text-xs">Milestone — {moment ?? 'nothing picked'}</label>
      <DateTimePicker className="max-w-64" value={moment} onChange={setMoment} />
    </Section>
  );
}
