import { Button, Checkbox, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { splitLines } from '../util';
import { NameListPanel } from './NameListPanel';

export function SelectionSection() {
  const { run, c } = useDemo();
  const [names, setNames] = useState('');
  const [append, setAppend] = useState(false);
  const [skip, setSkip] = useState('FRAME, BRACKET*');
  const [maxItems, setMaxItems] = useState('200');
  const [parents, setParents] = useState(false);

  /** Comma separated skip prefixes (a trailing * is fine), blank = no skipping. */
  const skipPrefixes = () =>
    skip
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

  const handleSet = () => {
    const fullnames = splitLines(names);
    void run('selection.set', { fullnames, append }, () => c().selectionSet(fullnames, { append }));
  };

  /** selection.get with every selected node (+ parents when ticked). */
  const handleGetItems = () => {
    const prefixes = skipPrefixes();
    const cap = Number.parseInt(maxItems, 10);
    const opts = {
      items: true as const,
      ...(prefixes.length ? { skip: prefixes } : {}),
      ...(cap > 0 ? { maxItems: cap } : {}),
      ...(parents ? { parents: true as const } : {}),
    };
    void run('selection.get', opts, () => c().selectionGet(opts));
  };

  /** selection.get with only the ancestors — the levels above the
   *  selection, each once — no items list. */
  const handleGetParents = () => {
    const prefixes = skipPrefixes();
    const opts = { parents: true as const, ...(prefixes.length ? { skip: prefixes } : {}) };
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
      <Row>
        <Checkbox checked={parents} onChange={setParents} label="parents (with items)" />
        <Button onClick={handleGetParents}>selection.get (parents)</Button>
      </Row>
      <Hint>
        items = every selected node (grouping rows and leaves); parents = every ancestor above the selection, import
        folders included, each once, also for root-less selections (invert, rectangle, SQL); skip drops names starting
        with any comma-separated prefix, case-insensitive.
      </Hint>
      <NameListPanel />
    </DemoSection>
  );
}
