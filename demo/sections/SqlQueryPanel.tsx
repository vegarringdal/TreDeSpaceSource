import { Button, Checkbox, Select, type SelectOption, SqlCodeEditor } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

type SqlQueryPanelProps = Readonly<{
  dbs: readonly string[];
  mainDb: string | null;
  onMainDbChange: (db: string | null) => void;
}>;

const DEFAULT_SQL = "SELECT name FROM sqlite_master WHERE type='table';";

const LOCK_OPTIONS: SelectOption[] = [
  { value: 'shared', label: 'shared (read-only)' },
  { value: 'exclusive', label: 'exclusive (writes)' },
];

/** SQL runner against the picked main db (results go to the log). */
export function SqlQueryPanel({ dbs, mainDb, onMainDbChange }: SqlQueryPanelProps) {
  const { run, c, line } = useDemo();
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [lockmode, setLockmode] = useState<'shared' | 'exclusive'>('shared');
  const [toEditorReplace, setToEditorReplace] = useState(true);

  const dbOptions = dbs.map((path) => ({ value: path, label: path }));

  const handleLockChange = (v: string | null) => {
    if (v === 'shared' || v === 'exclusive') {
      setLockmode(v);
    }
  };

  const handleRun = () => {
    if (!mainDb) {
      line('err', 'run sql.list and pick a main db first');
      return;
    }

    void run('sql.query', { mainDb, lockmode, sql }, () => c().sqlQuery({ sql, mainDb, lockmode }));
  };

  // the full statement form: one transaction, bulk bindings stepped per row,
  // collect only where wanted, progress per statement and per N rows
  const handleExecute = () => {
    if (!mainDb) {
      line('err', 'run sql.list and pick a main db first');
      return;
    }

    const rows = Array.from({ length: 2500 }, (_, i) => [i + 1, `TAG-${String(i + 1).padStart(4, '0')}`]);
    const statements = [
      { name: 'schema', sql: 'CREATE TABLE IF NOT EXISTS demo_tag(id INTEGER PRIMARY KEY, name TEXT)' },
      { name: 'clear', sql: 'DELETE FROM demo_tag' },
      { name: 'load', sql: 'INSERT INTO demo_tag(id, name) VALUES (?, ?)', binding: rows },
      { name: 'count', sql: 'SELECT count(*) AS n FROM demo_tag', collect: true },
    ];
    void run('sql.execute', { mainDb, lockmode: 'exclusive', statements: '(4 statements, 2500 bound rows)' }, () =>
      c().sqlExecute({
        mainDb,
        lockmode: 'exclusive',
        statements,
        progressSize: 500,
        onProgress: (p) =>
          line(
            '',
            p.type === 'statement'
              ? `  … statement ${p.no + 1}/${p.total} done${p.name ? ` (${p.name})` : ''}`
              : `  … ${p.no} rows`,
          ),
      }),
    );
  };

  /** Hand the SQL to the editor panel instead of running it: appending gives
   *  the block a title so several can be stacked. */
  const handleToEditor = () => {
    const input = {
      sql,
      replace: toEditorReplace,
      name: 'demo query',
      ...(mainDb ? { mainDb } : {}),
    };
    void run('sql.editor', input, () => c().sqlEditor(input));
  };

  return (
    <>
      <Hint>Run SQL against the picked main db (results to the log):</Hint>
      <Select value={mainDb} onChange={onMainDbChange} options={dbOptions} placeholder="sql.list to populate…" />
      <SqlCodeEditor value={sql} onChange={setSql} onRun={handleRun} className="h-24" resizable />
      <Row>
        <Select value={lockmode} onChange={handleLockChange} options={LOCK_OPTIONS} className="min-w-40" />
        <Button onClick={handleRun}>sql.query</Button>
        <Button
          tooltip="Batch demo: create + clear + bulk-insert 2500 bound rows + count, ONE transaction, with per-statement and per-500-rows progress"
          onClick={handleExecute}
        >
          sql.execute (batch)
        </Button>
        <Button
          tooltip="Pre-flight WITHOUT running: which dbs does this script reference (mainDb + ATTACH literals), do they exist, and their import-time md5"
          onClick={() =>
            void run('sql.check', { sql, mainDb }, () => c().sqlCheck({ sql, ...(mainDb ? { mainDb } : {}) }))
          }
        >
          sql.check
        </Button>
      </Row>
      <Row>
        <Checkbox checked={toEditorReplace} onChange={setToEditorReplace} label="replace editor text" />
        <Button
          tooltip="Hand this SQL to the viewer's SQL Editor panel for the user to run — replace the script, or append it as a titled block"
          onClick={handleToEditor}
        >
          sql.editor
        </Button>
      </Row>
    </>
  );
}
