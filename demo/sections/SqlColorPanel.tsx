import { Button, Checkbox, Select, type SelectOption, SqlCodeEditor, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { ColorMode } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

type SqlColorPanelProps = Readonly<{ mainDb: string | null }>;

const DEFAULT_SQL = "SELECT fullname, 'yellow' AS fullname_color FROM part WHERE type = 'PIPE'";

const MODE_OPTIONS: SelectOption[] = [
  { value: 'default-white', label: 'default-white (white base + hits)' },
  { value: 'default-hidden', label: 'default-hidden (isolate the hits)' },
  { value: 'default-transparent', label: 'default-transparent (10% white base)' },
  { value: 'default-set', label: 'default-set (over the Set Color rules)' },
  { value: 'custom-color', label: 'custom-color (orange hits, no base)' },
  { value: 'custom-set', label: 'custom-set (own rules + red hits)' },
];

type ModeKey = (typeof MODE_OPTIONS)[number]['value'];

/** The demo's stand-in for a config a host would keep on its own side. */
const DEMO_SET_CONFIG = {
  rules: [
    {
      comment: 'host config',
      filters: [{ op: 'append' as const, mode: 'contains' as const, value: '' }],
      color: '#dddddd',
    },
  ],
  mode: 'reset' as const,
};

/** Build the payload mode from the dropdown choice. */
function modeFor(key: ModeKey): ColorMode {
  if (key === 'default-transparent') {
    return { type: 'default-transparent', opacity: 0.1 };
  }
  if (key === 'custom-color') {
    return { type: 'custom-color', color: 'orange', base: 'none' };
  }
  if (key === 'custom-set') {
    return { type: 'custom-set', color: 'red', setConfig: DEMO_SET_CONFIG };
  }
  return { type: key === 'default-hidden' || key === 'default-set' ? key : 'default-white' };
}

/** The SQL editor's colour/select/table/detail buttons, driven over the API —
 *  the query result stays inside the viewer. */
export function SqlColorPanel({ mainDb }: SqlColorPanelProps) {
  const { run, c, line } = useDemo();
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [mode, setMode] = useState<ModeKey>('default-white');
  const [append, setAppend] = useState(false);
  const [detailName, setDetailName] = useState('Part card');

  const handleModeChange = (v: string | null) => {
    if (MODE_OPTIONS.some((o) => o.value === v)) {
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
    void run('sql.detail', { mainDb, sql, name }, () => c().sqlDetail({ mainDb, sql, ...(name ? { name } : {}) }));
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
        <Select value={mode} onChange={handleModeChange} options={MODE_OPTIONS} className="min-w-56" />
        <Button onClick={handleColor}>sql.color</Button>
        <Button onClick={handleSelect}>sql.select</Button>
        <Checkbox checked={append} onChange={setAppend} label="append" />
      </Row>
      <Row>
        <Button tooltip="Show the result in the viewer's SQL Table panel" onClick={handleTable}>
          sql.table
        </Button>
        <TextInput value={detailName} onChange={setDetailName} placeholder="panel name (blank = built-in)" />
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
