import { DockView, definePanel, type PanelDefinition, split, tabs, useDockManager } from '@treDeSpaceUI/dockable';
import { Section } from './Section';

const dockPanels: PanelDefinition[] = [
  definePanel({
    id: 'hierarchy',
    title: 'Hierarchy',
    minWidth: 140,
    component: () => <div className="p-2 text-slate-400">Drag my tab — dock, split, float.</div>,
  }),
  definePanel({
    id: 'inspector',
    title: 'Inspector',
    minWidth: 110,
    component: () => (
      <div className="p-2 text-slate-400">I'm size-locked (padlock above) — divider drags push me as a block.</div>
    ),
  }),
  definePanel({
    id: 'properties',
    title: 'Properties',
    minWidth: 150,
    component: () => <div className="p-2 text-slate-400">Panels keep React state across re-docking.</div>,
  }),
  definePanel({
    id: 'log',
    title: 'Log',
    minWidth: 110,
    component: () => (
      <div className="p-2 text-slate-400">Resizing cascades: when I hit my minimum, my neighbour yields.</div>
    ),
  }),
];

/** Gallery section for the dockable panel shell. */
export function DockDemo() {
  const manager = useDockManager(() => ({
    panels: dockPanels,
    layout: split(
      'row',
      [tabs(['hierarchy']), tabs(['inspector'], { sizeLocked: true }), tabs(['properties']), tabs(['log'])],
      [28, 20, 30, 22],
    ),
  }));
  return (
    <Section
      title="Dockable"
      note="The other half of @treDeSpaceUI: the dockable panel shell the whole app runs in. Define panels, build a layout from split()/tabs(), and mount a DockView — then drag tabs to re-dock, split, or float them. Divider drags CASCADE: when the shrinking panel reaches its minimum size, the next one yields, until the side is exhausted. The tab-strip padlock size-locks a group: its current size becomes its minimum — it can grow, but never shrinks below it, so drags cascade straight past. Layouts serialize to plain JSON via saveLayout()/loadLayout()."
      props={['DockManagerOptions', 'PanelDefinition', 'SplitNode', 'TabsNode', 'LayoutNode']}
      code={`const panels = [
  definePanel({ id: 'tree', title: 'Hierarchy', minWidth: 140, component: TreePanel }),
  definePanel({ id: 'props', title: 'Properties', minWidth: 150, component: PropsPanel }),
];
// sizeLocked: the group's current size becomes its minimum (it can grow, never shrink below)
const layout = split('row', [tabs(['tree']), tabs(['props'], { sizeLocked: true })], [60, 40]);

function Workspace() {
  const manager = useDockManager(() => ({ panels, layout }));
  return <DockView manager={manager} />; // container needs a real height
}`}
    >
      <div className="h-72 overflow-hidden rounded border border-slate-800">
        <DockView manager={manager} />
      </div>
    </Section>
  );
}
