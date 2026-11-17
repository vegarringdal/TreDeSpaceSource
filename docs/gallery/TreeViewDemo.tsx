import { IconCube, IconEye, IconFolder } from '@tabler/icons-react';
import { Badge, Button, TreeView, type TreeViewRow } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

type Node = { key: string; depth: number; name: string; kids?: boolean; items?: number; hidden?: boolean };

const NODES: readonly Node[] = [
  { key: 'plant', depth: 0, name: 'PLANT-A', kids: true },
  { key: 'plant/z1', depth: 1, name: 'ZONE-01', kids: true, items: 128 },
  { key: 'plant/z1/p1', depth: 2, name: 'PIPE-8821' },
  { key: 'plant/z1/p2', depth: 2, name: 'PIPE-8822' },
  { key: 'plant/z2', depth: 1, name: 'ZONE-02', kids: true, items: 64 },
  { key: 'plant/z2/v1', depth: 2, name: 'VALVE-01' },
  { key: 'plant/z2/v2', depth: 2, name: 'VALVE-02', hidden: true },
];

/** A count badge, or — on a hidden row — a button that must not also select the row. */
function trailingFor(n: Node) {
  if (n.items != null) {
    return <Badge>{n.items}</Badge>;
  }
  if (!n.hidden) {
    return undefined;
  }
  return (
    <Button
      iconOnly
      size="xs"
      variant="ghost"
      icon={<IconEye />}
      tooltip="Show (demo)"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Gallery section for TreeView. */
export function TreeViewDemo() {
  const [open, setOpen] = useState(new Set(['plant', 'plant/z1']));
  const [selected, setSelected] = useState('plant/z1/p1');

  const visible = NODES.filter((n) => {
    const parent = n.key.slice(0, n.key.lastIndexOf('/'));
    return n.depth === 0 || open.has(parent);
  });

  const rows: TreeViewRow[] = visible.map((n) => ({
    key: n.key,
    depth: n.depth,
    label: n.name,
    icon: n.kids ? (
      <IconFolder size={14} className="shrink-0 text-amber-400/80" />
    ) : (
      <IconCube size={14} className="shrink-0 text-sky-400/80" />
    ),
    expandable: n.kids,
    expanded: open.has(n.key),
    selected: selected === n.key,
    partial: n.key === 'plant/z2',
    partialTooltip: 'Some of the items below this row are selected',
    muted: n.hidden,
    trailing: trailingFor(n),
  }));

  return (
    <Section
      title="TreeView"
      note="The app's tree list: indent, twisty, selection and partial-selection highlighting over a FLAT list of the rows that are visible right now — the tree draws, it never owns the model, so a lazily-loaded tree costs nothing until it is expanded. Rows are focusable treeitems (Enter / Space click them), so `trailing` may hold buttons — stop propagation in one that must not select the row; `muted` dims hidden content, `band` + `disabled` draw grouping chrome. Give it a rowHeight and it virtualizes (only the rows in view are mounted); `rowProps` is the escape hatch for drag-and-drop. FileTree is this widget plus a file model."
      props={['TreeViewProps', 'TreeViewRow', 'TreeRowExtras']}
      code={`// nodes, visibleRows(), toggle(), select() and openMenu() are yours
function Hierarchy() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const rows = visibleRows(nodes, open).map((n) => ({
    key: n.id, depth: n.depth, label: n.name,
    expandable: n.hasChildren, expanded: open.has(n.id),
    selected: n.selected, partial: n.partial,
  }));
  return (
    <TreeView
      rows={rows}
      rowHeight={22}
      onToggle={(row) => setOpen(toggle(open, row.key))}
      onRowClick={(row, e) => select(row.key, e)}
      onRowContextMenu={(row, e) => openMenu(row, e)}
    />
  );
}`}
    >
      <TreeView
        className="max-h-56 border border-slate-800"
        rows={rows}
        rowHeight={22}
        indent={12}
        padLeft={8}
        emptyText="Nothing loaded."
        onToggle={(row) =>
          setOpen((s) => {
            const next = new Set(s);
            if (next.has(row.key)) {
              next.delete(row.key);
            } else {
              next.add(row.key);
            }
            return next;
          })
        }
        onRowClick={(row) => setSelected(row.key)}
      />
      <div className="mt-2 text-slate-400">selected: {selected}</div>
    </Section>
  );
}
