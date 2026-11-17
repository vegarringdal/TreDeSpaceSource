import { Button, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

const DEFAULT_ID = 'transform.undo';

/** The shortcut table as data and running a shortcut by id — what a host
 *  needs to mirror the viewer's shortcuts (tooltips, a command palette) in its
 *  own UI. The table is long, so it is logged one line per shortcut. */
export function HotkeysSection() {
  const { run, c, line } = useDemo();
  const [category, setCategory] = useState('');
  const [id, setId] = useState(DEFAULT_ID);

  const handleList = () => {
    const opts = category.trim() ? { category: category.trim() } : {};
    void run('hotkeys.list', opts, async () => {
      const res = await c().hotkeysList(opts);
      if (res.error || !res.data) {
        return res;
      }
      for (const h of res.data.hotkeys) {
        line('', `  ${h.id} · ${h.keys} · ${h.label}${h.isCustom ? ' (custom)' : ''}`);
      }
      return { data: { count: res.data.hotkeys.length } };
    });
  };

  const handleRun = () => void run('hotkeys.run', { id }, () => c().hotkeysRun(id.trim()));

  return (
    <DemoSection
      title="Hotkeys"
      info={
        <>
          hotkeys.list is the viewer's whole shortcut table — ids, labels, tooltip-ready descriptions and the live key
          combos (the user's rebinds included), the same record the in-app tooltips read. hotkeys.run fires one by id,
          fire-and-forget: the response only confirms dispatch, never completion. Rebind a key under the viewer's
          Settings → Hotkeys and watch hotkeys.changed arrive in the log.
        </>
      }
    >
      <Row>
        <TextInput label="category" labelPosition="left" labelWidth={64} value={category} onChange={setCategory} />
        <Button onClick={handleList}>hotkeys.list</Button>
      </Row>
      <Row>
        <TextInput label="id" labelPosition="left" labelWidth={64} value={id} onChange={setId} />
        <Button onClick={handleRun}>hotkeys.run</Button>
      </Row>
      <Hint>Category is optional (Camera, Selection, View, …); empty lists everything, one log line per shortcut.</Hint>
    </DemoSection>
  );
}
