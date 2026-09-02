import { Button, Select, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { encodeNameList } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { LIST_MODE_OPTIONS, type ModeKey, modeFor } from './colorModes';

const isMode = (v: string | null): v is ModeKey => LIST_MODE_OPTIONS.some((o) => o.value === v);

/** The binary name list: encodeNameList → one transferred buffer, packed
 *  viewer-side. Lines are `fullname` or `fullname<TAB>color[:opacity]`. */
export function NameListPanel() {
  const { run, c } = useDemo();
  const [text, setText] = useState('/SITE/PIPE-01\tyellow\n/SITE/PIPE-02\t#ff0000:50');
  const [mode, setMode] = useState<ModeKey>('default-white');

  const entries = () =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

  const handleSelect = () => {
    const list = encodeNameList(entries());
    void run('selection.setList', { names: entries().length }, () => c().selectionSetList(list));
  };

  const handleColor = () => {
    const list = encodeNameList(entries());
    const colorMode = modeFor(mode);
    void run('colorRules.applyList', { names: entries().length, mode: colorMode }, () =>
      c().colorApplyList(list, { mode: colorMode }),
    );
  };

  return (
    <>
      <Hint>
        Big lists your own backend produced: <code>encodeNameList()</code> packs them into one UTF-8 buffer that is
        TRANSFERRED to the viewer — no per-row JSON on either side. One name per line, optionally{' '}
        <code>name&lt;TAB&gt;color[:opacity]</code>.
      </Hint>
      <TextArea value={text} onChange={setText} rows={3} />
      <Row>
        <Button onClick={handleSelect}>selection.setList</Button>
        <Select
          value={mode}
          onChange={(v) => isMode(v) && setMode(v)}
          options={LIST_MODE_OPTIONS}
          className="min-w-56"
        />
        <Button onClick={handleColor}>colorRules.applyList</Button>
      </Row>
    </>
  );
}
