import { IconPlayerPlay } from '@tabler/icons-react';
import { Button, ChapterList, type ChapterListRow } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const ROWS: ChapterListRow[] = [
  { id: 'a', depth: 0, title: 'Base frame', duration: '4.0s', status: 'done', heading: 'Phase 1 · Structure' },
  {
    id: 'b',
    depth: 0,
    title: 'Pump skid',
    subtitle: 'Lift the skid onto the base and align the bolts.',
    duration: '6.5s',
    status: 'current',
    progress: 0.6,
    note: 'paused',
  },
  { id: 'c', depth: 1, title: 'Motor', duration: '3.0s', status: 'upcoming', warning: true },
  { id: 'd', depth: 0, title: 'Piping', duration: '8.0s', status: 'upcoming' },
];

/** Gallery section for ChapterList. */
export function ChapterListDemo() {
  const [rows, setRows] = useState(ROWS);
  const [active, setActive] = useState('b');
  const activate = (id: string) => {
    setActive(id);
    setRows((rs) =>
      rs.map((r) => ({ ...r, status: r.id === id ? 'current' : r.status === 'current' ? 'done' : r.status })),
    );
  };
  return (
    <Section
      title="ChapterList"
      note="An ordered list of chapters — the parts of a sequence, the steps of a walkthrough: number (or ✓ when done), title, length, a current row with an accent edge and an optional progress bar, a warning badge, a small note and hover actions; a row's heading titles the group it starts. Rows are numbered per depth through the whole list. The expanded row shows its subtitle and detail. ↑/↓ move between rows, Enter activates; `onReorder` adds drag-to-reorder (a row dropped on another moves before it)."
      props={['ChapterListProps', 'ChapterListRow']}
      code={`// parts and play() come from your model
function Chapters() {
  const [current, setCurrent] = useState<string | null>(parts[0]?.id ?? null);
  return (
    <ChapterList
      rows={parts.map((p) => ({ id: p.id, depth: 0, title: p.name, duration: p.length,
                                status: p.id === current ? 'current' : 'upcoming' }))}
      expanded={current}
      onActivate={setCurrent}
      renderActions={(row) => (
        <Button iconOnly size="sm" variant="ghost" icon={<IconPlayerPlay />}
                tooltip="Play from here" onClick={() => play(row.id)} />
      )}
    />
  );
}`}
    >
      <div className="w-80 border border-slate-800">
        <ChapterList
          rows={rows}
          expanded={active}
          onActivate={activate}
          renderActions={(row) => (
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              icon={<IconPlayerPlay />}
              tooltip={`Play ${row.title}`}
              onClick={() => activate(row.id)}
            />
          )}
          onReorder={(id, to) =>
            setRows((rs) => {
              const moved = rs.find((r) => r.id === id);
              const rest = rs.filter((r) => r.id !== id);
              const at = rest.findIndex((r) => r.id === to.beforeId);
              return moved ? [...rest.slice(0, at), moved, ...rest.slice(at)] : rs;
            })
          }
        />
      </div>
    </Section>
  );
}
