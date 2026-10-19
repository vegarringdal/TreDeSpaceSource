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
      note="Single- and multi-line text fields with the shared label props — on top, to the left (share one labelWidth so stacked fields align) or split — a clear button (`clearable`; `onClear` overrides it, e.g. reset-to-default), `tooltip` + `shortcut`, and onCommit for commit-style handling (TextInput: Enter and blur; TextArea: blur). TextInput also takes `autoFocus` for a dialog's single field and an `onKeyDown` that runs first — preventDefault() there skips the Enter commit."
      props={['TextInputProps', 'TextAreaProps', 'LabelledProps']}
      code={`function Details({ onSaveTag }: { onSaveTag: (tag: string) => void }) {
  const [name, setName] = useState('Torus knot');
  const [tag, setTag] = useState('hero-prop');
  const [notes, setNotes] = useState('');
  return (
    <>
      <TextInput label="Name" value={name} onChange={setName} />
      <TextInput label="Tag" labelPosition="left" labelWidth={44}
        tooltip="Saved on Enter or when you leave the field"
        value={tag} onChange={setTag} onCommit={onSaveTag} />
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
