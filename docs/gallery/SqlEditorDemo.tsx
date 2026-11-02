import { SqlCodeEditor } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const demoSql = `-- Tab / Shift+Tab indent the selected lines
SELECT name, size_mb
FROM assets
WHERE size_mb > 10
ORDER BY size_mb DESC;`;

/** Gallery section for SqlCodeEditor. */
export function SqlEditorDemo() {
  const [sql, setSql] = useState(demoSql);
  return (
    <Section
      title="SqlCodeEditor"
      note="A dependency-free SQL editor: a transparent textarea over a highlighted layer, with a line gutter. Tab / Shift+Tab indent and outdent the lines a multi-line selection touches (caret or one-line selection: Tab inserts one indent, replacing the selection; Shift+Tab removes one), Enter keeps the indentation, Ctrl/Cmd+Enter is left to the host's hotkeys, onSelect reports the caret selection so a host can run only the highlighted text. Height comes from className; resizable adds a drag handle."
      props={['SqlCodeEditorProps']}
      code={`function QueryEditor() {
  const [sql, setSql] = useState('SELECT 1;');
  return <SqlCodeEditor className="h-32" resizable value={sql} onChange={setSql} />;
}`}
    >
      <SqlCodeEditor className="h-32" resizable value={sql} onChange={setSql} />
    </Section>
  );
}
