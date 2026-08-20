import { Button, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for useFilePicker / readFileText. */
export function FilePickerDemo() {
  const [info, setInfo] = useState('');
  const { element, open } = useFilePicker('.txt,.md,.json,.csv', (file) =>
    readFileText(file, (text) => setInfo(`${file.name} — ${file.size} bytes, starts: "${text.slice(0, 40)}"`)),
  );
  return (
    <Section
      title="useFilePicker"
      note="A hidden file input + an open() trigger — the shared piece of every panel's Load… button. Render the returned element anywhere in the tree; useMultiFilePicker is the several-files variant, readFileText the text helper."
      code={`function LoadButton() {
  const [text, setText] = useState('');
  const { element, open } = useFilePicker('.json', (file) =>
    readFileText(file, setText));
  return (
    <>
      {element}
      <Button onClick={open}>Load…</Button>
    </>
  );
}`}
    >
      {element}
      <Button onClick={open}>Load a text file…</Button>
      {info && <p className="m-0 mt-2 max-w-[60ch] break-words text-slate-500 text-xs">{info}</p>}
    </Section>
  );
}
