import { Button, Select, type SelectOption, SqlCodeEditor } from '@treDeSpaceUI/widgets';
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

  return (
    <>
      <Hint>Run SQL against the picked main db (results to the log):</Hint>
      <Select value={mainDb} onChange={onMainDbChange} options={dbOptions} placeholder="sql.list to populate…" />
      <SqlCodeEditor value={sql} onChange={setSql} onRun={handleRun} className="h-24" resizable />
      <Row>
        <Select value={lockmode} onChange={handleLockChange} options={LOCK_OPTIONS} className="min-w-40" />
        <Button onClick={handleRun}>sql.query</Button>
        <Button
          tooltip="Pre-flight WITHOUT running: which dbs does this script reference (mainDb + ATTACH literals), do they exist, and their import-time md5"
          onClick={() =>
            void run('sql.check', { sql, mainDb }, () => c().sqlCheck({ sql, ...(mainDb ? { mainDb } : {}) }))
          }
        >
          sql.check
        </Button>
      </Row>
    </>
  );
}
