import {
  Breadcrumbs,
  Timeline,
  type TimelineItem,
  type TimelinePoint,
  type TimelineRow,
  type TimelineView,
} from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const ROWS: TimelineRow[] = [
  { id: 'g1', kind: 'group', depth: 0, label: 'Step 1', tint: '#3b82f6', collapsible: true },
  { id: 'l1', kind: 'lane', depth: 1, label: 'Base frame' },
  { id: 'g2', kind: 'group', depth: 0, label: 'Step 2', tint: '#22c55e', collapsible: true },
  { id: 'l2', kind: 'lane', depth: 1, label: 'Pump skid' },
  { id: 'k', kind: 'lane', depth: 2, label: '↳ keys' },
  { id: 'ov', kind: 'lane', depth: 0, label: 'Overlays' },
];

const START: TimelineItem[] = [
  { id: 's1', row: 'g1', start: 0, end: 3, label: 'Step 1', span: true, tint: '#3b82f6' },
  { id: 'c1', row: 'l1', start: 0, end: 3, label: 'Slide in', hatched: true },
  { id: 's2', row: 'g2', start: 3, end: 7, label: 'Step 2', span: true, tint: '#22c55e' },
  { id: 'c2', row: 'l2', start: 3, end: 7, label: 'Drop in', linkFrom: { id: 'c1', kind: 'after' } },
  { id: 'card', row: 'ov', start: 3, end: 7, label: 'Card · Step 2 (fixed)', tint: '#64748b', fixed: true },
  // an instant clip (no length) drawn wide enough to read and click
  { id: 'look', row: 'ov', start: 1, end: 1, label: 'Look', tint: '#a855f7', minWidth: 44 },
];

const POINTS: TimelinePoint[] = [
  { id: 'p1', row: 'k', t: 3, shape: 'diamond' },
  { id: 'p2', row: 'k', t: 5, shape: 'diamond', hollow: true, label: 'Hold key' },
  { id: 'p3', row: 'k', t: 7, shape: 'diamond' },
  { id: 'm1', row: 'g2', t: 7, shape: 'marker', label: 'Pauses here' },
];

/** The rows left once each collapsed row hides the deeper rows under it —
 *  the Timeline draws every row it is given. */
function visibleRows(rows: readonly TimelineRow[], collapsed: ReadonlySet<string>): TimelineRow[] {
  const out: TimelineRow[] = [];
  let hideBelow: number | null = null;
  for (const row of rows) {
    if (hideBelow !== null && row.depth > hideBelow) {
      continue;
    }
    hideBelow = collapsed.has(row.id) ? row.depth : null;
    out.push({ ...row, collapsed: collapsed.has(row.id) });
  }
  return out;
}

/** Gallery section for Timeline, TimeRuler and Breadcrumbs. */
export function TimelineDemo() {
  const [view, setView] = useState<TimelineView>({ pxPerSec: 50, offset: 0 });
  const [labelWidth, setLabelWidth] = useState(150);
  const [playhead, setPlayhead] = useState(4.2);
  const [items, setItems] = useState(START);
  const [base, setBase] = useState(START);
  const [sel, setSel] = useState<string[]>([]);
  const [log, setLog] = useState('');
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const handleToggleRow = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const handleSelect = (s: { items: string[] }, additive: boolean) =>
    setSel((cur) => (additive ? [...new Set([...cur, ...s.items])] : s.items));

  return (
    <Section
      title="Timeline / TimeRuler / Breadcrumbs"
      note="A multi-lane timeline: group and lane rows with a resizable label column (onLabelWidthChange); a collapsible row's twisty calls onToggleRow and you drop its children from rows. Span bars and clip blocks drag with snapping and propose magnetic links (drop near another's end → after, start → with, end on end → ends with; Alt = no link); clip edges resize; locked items dim and never drag or click-select, fixed ones select and open but never drag (the card follows its step); minWidth keeps an instant clickable. Key diamonds (filled, or hollow for a key that holds), markers, a playhead, a dashed end mark, a dimmed outside and an in/out range (Shift+drag the ruler, Shift+click clears). Ctrl+wheel zooms, Shift+wheel pans, a click on empty space seeks, a drag there box-selects, ←/→ scrub (the view follows), +/− zoom; a scrub or a clip / key drag held at an edge scrolls the view along. Pure presentation — every edit comes back through the callbacks; drags carry a phase and a dt from the press, so preview on 'drag' and commit on 'end'. TimeRuler works on its own; Breadcrumbs shows where you are."
      props={[
        'TimelineProps',
        'TimelineRow',
        'TimelineItem',
        'TimelinePoint',
        'TimelineView',
        'TimelineSnap',
        'DropHint',
        'TimeRulerProps',
        'BreadcrumbsProps',
      ]}
      code={`// rows / items / keys / keyTimes / path come from your model; edit.* writes it back
function Editor() {
  const [view, setView] = useState<TimelineView>({ pxPerSec: 50, offset: 0 });
  const [labelWidth, setLabelWidth] = useState(150);
  const [t, setT] = useState(0);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleRow = (id: string) =>
    setCollapsed((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return (
    <>
      <Breadcrumbs items={path} onSelect={edit.goUpTo} />
      <Timeline
        // the widget hides nothing: leave a collapsed row's children out yourself
        rows={visibleRows(rows, collapsed)}
        items={items} points={keys}
        playhead={t} duration={30} view={view} endMark={24} range={range}
        labelWidth={labelWidth} onLabelWidthChange={setLabelWidth}
        snap={{ enabled: true, step: 0.5, targets: keyTimes }}
        onViewChange={setView} onSeek={setT} onRangeChange={setRange} onToggleRow={toggleRow}
        // dt counts from the press, not per event: preview on 'drag', commit once on 'end'
        onItemsMove={(ids, dt, hint, phase) => edit.moveItems(ids, dt, hint, phase)}
        onItemResize={(id, edge, time, _shift, phase) => edit.resize(id, edge, time, phase)}
        onPointsMove={(ids, dt, phase) => edit.moveKeys(ids, dt, phase)}
        onSelect={(sel, additive) => edit.select(sel, additive)}
        onOpen={(target) => edit.open(target)}
        onContextMenu={(target, at) => edit.openMenu(target, at)}
      />
    </>
  );
}`}
    >
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { id: 'a', label: 'Assembly' },
            { id: 'b', label: 'Step 2' },
            { id: 'c', label: 'Pump skid' },
          ]}
          onSelect={(id) => setLog(`crumb ${id}`)}
        />
        <div className="h-48 border border-slate-800">
          <Timeline
            labelWidth={labelWidth}
            onLabelWidthChange={setLabelWidth}
            rows={visibleRows(ROWS, collapsed)}
            items={items.map((i) => ({ ...i, selected: sel.includes(i.id) }))}
            points={POINTS}
            playhead={playhead}
            duration={10}
            view={view}
            range={range}
            endMark={8}
            snap={{ enabled: true, step: 0.5, targets: [0, 3, 7] }}
            onViewChange={setView}
            onSeek={setPlayhead}
            onItemsMove={(ids, dt, hint, phase) => {
              setItems(base.map((i) => (ids.includes(i.id) ? { ...i, start: i.start + dt, end: i.end + dt } : i)));
              if (phase === 'end') {
                setBase(base.map((i) => (ids.includes(i.id) ? { ...i, start: i.start + dt, end: i.end + dt } : i)));
                setLog(hint ? `link ${ids[0]} ${hint.kind} ${hint.target}` : `moved ${ids.join(', ')}`);
              }
            }}
            onItemResize={(id, edge, t) => setLog(`resize ${id} ${edge} → ${t.toFixed(2)}`)}
            onPointsMove={(ids, dt) => setLog(`keys ${ids.join(', ')} by ${dt.toFixed(2)}`)}
            onSelect={handleSelect}
            onToggleRow={handleToggleRow}
            onOpen={(t) => setLog(`open ${t.kind} ${t.id}`)}
            onContextMenu={(t) => setLog(`menu on ${t.kind} at ${t.t.toFixed(2)} s`)}
            onRangeChange={setRange}
          />
        </div>
        <span className="text-slate-400">{log || 'drag a clip next to another to see the link hint'}</span>
      </div>
    </Section>
  );
}
