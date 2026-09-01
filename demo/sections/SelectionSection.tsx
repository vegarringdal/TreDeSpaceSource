import { Button, Checkbox, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { splitLines } from '../util';

export function SelectionSection() {
  const { run, c } = useDemo();
  const [names, setNames] = useState('');
  const [append, setAppend] = useState(false);
  const [skip, setSkip] = useState('FRAME, BRACKET*');
  const [maxItems, setMaxItems] = useState('200');

  const handleSet = () => {
    const fullnames = splitLines(names);
    void run('selection.set', { fullnames, append }, () => c().selectionSet(fullnames, { append }));
  };

  /** selection.get with every selected node: skip prefixes are comma
   *  separated (a trailing * is fine), blank = no skipping. */
  const handleGetItems = () => {
    const prefixes = skip
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    const cap = Number.parseInt(maxItems, 10);
    const opts = {
      items: true as const,
      ...(prefixes.length ? { skip: prefixes } : {}),
      ...(cap > 0 ? { maxItems: cap } : {}),
    };
    void run('selection.get', opts, () => c().selectionGet(opts));
  };

  return (
    <DemoSection title="Selection">
      <TextArea value={names} onChange={setNames} rows={3} />
      <Hint>One fullname per line (load a model first, e.g. via Import Manager).</Hint>
      <Checkbox checked={append} onChange={setAppend} label="append (add to the current selection)" />
      <Row>
        <Button onClick={handleSet}>selection.set</Button>
        <Button onClick={() => void run('selection.get', {}, () => c().selectionGet())}>selection.get</Button>
        <Button onClick={() => void run('selection.clear', {}, () => c().selectionClear())}>selection.clear</Button>
      </Row>
      <Row>
        <span className="text-slate-400 text-xs">skip starts-with</span>
        <TextInput value={skip} onChange={setSkip} placeholder="FRAME, BRACKET*" />
        <span className="text-slate-400 text-xs">maxItems</span>
        <TextInput value={maxItems} onChange={setMaxItems} />
        <Button onClick={handleGetItems}>selection.get (items)</Button>
      </Row>
      <Hint>
        items = every selected node (grouping rows and leaves); skip drops names starting with any comma-separated
        prefix, case-insensitive.
      </Hint>
    </DemoSection>
  );
}
