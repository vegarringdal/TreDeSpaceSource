import { SqlCodeEditor } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const demoSql = `-- Ctrl+Enter runs (wired to onRun)
SELECT name, size_mb
FROM assets
WHERE size_mb > 10
ORDER BY size_mb DESC;`;

/** Gallery section for SqlCodeEditor. */
export function SqlEditorDemo() {
  const [sql, setSql] = useState(demoSql);
  const [ran, setRan] = useState(0);
  return (
    <Section
      title="SqlCodeEditor"
      note="A dependency-free SQL editor: a transparent textarea over a highlighted layer, with a line gutter. Tab indents, Ctrl/Cmd+Enter fires onRun, onSelect reports the caret selection so a host can run only the highlighted text. Height comes from className; resizable adds a drag handle."
      props={['SqlCodeEditorProps']}
      code={`function QueryEditor() {
  const [sql, setSql] = useState('SELECT 1;');
  return (
    <SqlCodeEditor className="h-32" resizable value={sql}
      onChange={setSql} onRun={() => run(sql)} />
  );
}`}
    >
      <SqlCodeEditor className="h-32" resizable value={sql} onChange={setSql} onRun={() => setRan((n) => n + 1)} />
      <p className="m-0 mt-2 text-slate-500 text-xs">
        {ran ? `onRun fired ${ran}×` : 'Press Ctrl+Enter in the editor'}
      </p>
    </Section>
  );
}
