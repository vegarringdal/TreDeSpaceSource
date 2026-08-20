import { TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for TextInput / TextArea. */
export function TextFieldDemo() {
  const [name, setName] = useState('Torus knot');
  const [tag, setTag] = useState('hero-prop');
  const [notes, setNotes] = useState('Rotates slowly.\nRetint via Assets panel.');
  return (
    <Section
      title="TextInput / TextArea"
      note="Single- and multi-line text fields with a label on top or to the left (share one labelWidth so stacked fields align), a clear button, and onCommit for Enter/blur-style handling."
      props={['TextInputProps', 'TextAreaProps']}
      code={`function Details() {
  const [name, setName] = useState('Torus knot');
  const [tag, setTag] = useState('hero-prop');
  const [notes, setNotes] = useState('');
  return (
    <>
      <TextInput label="Name" value={name} onChange={setName} />
      <TextInput label="Tag" labelPosition="left" labelWidth={44}
        value={tag} onChange={setTag} onCommit={saveTag} />
      <TextArea label="Notes" labelPosition="left" labelWidth={44}
        minHeight={56} value={notes} onChange={setNotes} />
    </>
  );
}`}
    >
      <TextInput label="Name (label top)" value={name} onChange={setName} placeholder="Object name…" />
      <TextInput className="mt-2" label="Tag" labelPosition="left" labelWidth={44} value={tag} onChange={setTag} />
      <TextArea
        className="mt-2"
        label="Notes"
        labelPosition="left"
        labelWidth={44}
        minHeight={56}
        value={notes}
        onChange={setNotes}
        placeholder="Anything worth remembering…"
      />
    </Section>
  );
}
