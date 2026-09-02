import { Button, Checkbox, Select, SqlCodeEditor, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';

import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { COLOR_MODE_OPTIONS, type ModeKey, modeFor } from './colorModes';

type SqlColorPanelProps = Readonly<{ mainDb: string | null }>;

const DEFAULT_SQL = "SELECT fullname, 'yellow' AS fullname_color FROM part WHERE type = 'PIPE'";

/** The SQL editor's colour/select/table/detail buttons, driven over the API —
 *  the query result stays inside the viewer. */
export function SqlColorPanel({ mainDb }: SqlColorPanelProps) {
  const { run, c, line } = useDemo();
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [mode, setMode] = useState<ModeKey>('default-white');
  const [append, setAppend] = useState(false);
  const [detailName, setDetailName] = useState('Part card');
  const [autoRemove, setAutoRemove] = useState(true);

  const handleModeChange = (v: string | null) => {
    if (COLOR_MODE_OPTIONS.some((o) => o.value === v)) {
      setMode(v as ModeKey);
    }
  };

  const handleColor = () => {
    if (!mainDb) {
      line('err', 'run sql.list and pick a main db first');
      return;
    }
    const colorMode = modeFor(mode);
    void run('sql.color', { mainDb, sql, mode: colorMode }, () =>
      c().sqlColor({ mainDb, sql, mode: colorMode, onProgress: (p) => line('', `  … ${p.rows} rows`) }),
    );
  };

  const handleSelect = () => {
    if (!mainDb) {
      line('err', 'run sql.list and pick a main db first');
      return;
    }
    void run('sql.select', { mainDb, sql, append }, () => c().sqlSelect({ mainDb, sql, append }));
  };

  const handleTable = () => {
    if (!mainDb) {
      line('err', 'run sql.list and pick a main db first');
      return;
    }
    void run('sql.table', { mainDb, sql }, () => c().sqlTable({ mainDb, sql, name: 'Demo query' }));
  };

  /** A name gives the query its own detail panel (titled with it); the same
   *  name again re-binds that panel. */
  const handleDetail = () => {
    if (!mainDb) {
      line('err', 'run sql.list and pick a main db first');
      return;
    }
    const name = detailName.trim();
    void run('sql.detail', { mainDb, sql, name, autoRemove }, () =>
      c().sqlDetail({ mainDb, sql, autoRemove, ...(name ? { name } : {}) }),
    );
  };

  return (
    <>
      <Hint>
        Colour / select FROM a query — the result never crosses the boundary: the viewer packs the fullnames inside its
        SQL worker and hands them to the model DB as flat buffers. The query needs a <code>fullname</code> column;{' '}
        <code>fullname_color</code> is optional (yellow when missing).
      </Hint>
      <SqlCodeEditor value={sql} onChange={setSql} onRun={handleColor} className="h-20" resizable />
      <Row>
        <Select value={mode} onChange={handleModeChange} options={COLOR_MODE_OPTIONS} className="min-w-56" />
        <Button onClick={handleColor}>sql.color</Button>
        <Button onClick={handleSelect}>sql.select</Button>
        <Checkbox checked={append} onChange={setAppend} label="append" />
      </Row>
      <Row>
        <Button tooltip="Show the result in the viewer's SQL Table panel" onClick={handleTable}>
          sql.table
        </Button>
        <TextInput value={detailName} onChange={setDetailName} placeholder="panel name (blank = built-in)" />
        <Checkbox checked={autoRemove} onChange={setAutoRemove} label="auto-remove on close" />
        <Button
          tooltip="Bind this SQL to a SQL Detail panel — hierarchy clicks then run it against the clicked node (use TREE_VIEW_ARGS). The name titles its own panel; the same name again re-binds it."
          onClick={handleDetail}
        >
          sql.detail
        </Button>
      </Row>
    </>
  );
}
