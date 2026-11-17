import { DateTimePicker, Labelled } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for DateTimePicker. */
export function DateTimePickerDemo() {
  const [moment, setMoment] = useState<string | null>(null);
  return (
    <Section
      title="DateTimePicker"
      note="Date + time in one field: the calendar picks the day, then the popover advances to the 24-hour clock (hour → minute → done); the header buttons re-enter either part. The value is an ISO local 'yyyy-mm-ddTHH:MM' string — no timezone, sorts correctly as plain text. onChange fires on every pick (day, hour, minute); parts not picked yet come from the value, or now."
      props={['DateTimePickerProps']}
      code={`function Milestone() {
  const [moment, setMoment] = useState<string | null>(null);
  return <DateTimePicker value={moment} onChange={setMoment} />;
}`}
    >
      <Labelled label={`Milestone — ${moment ?? 'nothing picked'}`}>
        <DateTimePicker className="max-w-64" value={moment} onChange={setMoment} />
      </Labelled>
    </Section>
  );
}
