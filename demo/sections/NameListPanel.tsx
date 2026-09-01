import { Button, Select, type SelectOption, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { type ColorMode, encodeNameList } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

const MODE_OPTIONS: SelectOption[] = [
  { value: 'default-white', label: 'default-white (white base + list)' },
  { value: 'default-hidden', label: 'default-hidden (isolate the list)' },
  { value: 'default-transparent', label: 'default-transparent (10% white base)' },
  { value: 'default-set', label: 'default-set (over the Set Color rules)' },
  { value: 'custom-color', label: 'custom-color (orange, no base coat)' },
];

type ModeKey = (typeof MODE_OPTIONS)[number]['value'];

const isMode = (v: string | null): v is ModeKey => MODE_OPTIONS.some((o) => o.value === v);

/** Dropdown choice → payload mode. */
function modeFor(key: ModeKey): ColorMode {
  if (key === 'default-transparent') {
    return { type: 'default-transparent', opacity: 0.1 };
  }
  if (key === 'custom-color') {
    return { type: 'custom-color', color: 'orange', base: 'none' };
  }
  return { type: key === 'default-hidden' || key === 'default-set' ? key : 'default-white' };
}

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
        <Select value={mode} onChange={(v) => isMode(v) && setMode(v)} options={MODE_OPTIONS} className="min-w-56" />
        <Button onClick={handleColor}>colorRules.applyList</Button>
      </Row>
    </>
  );
}
