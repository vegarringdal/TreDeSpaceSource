import { IconDatabase } from '@tabler/icons-react';
import { Button, FileTree, type TreeDir } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const dbIcon = <IconDatabase size={13} className="shrink-0 text-slate-500" />;

const demoTree: TreeDir = {
  kind: 'dir',
  name: '',
  path: '',
  children: [
    {
      kind: 'dir',
      name: 'main',
      path: 'store:main',
      variant: 'section',
      icon: dbIcon,
      children: [
        {
          kind: 'dir',
          name: 'Topside',
          path: 'Topside',
          children: [
            { kind: 'file', name: 'M110.model', path: 'Topside/M110.model', note: '12 MB' },
            { kind: 'file', name: 'M120.model', path: 'Topside/M120.model', note: '8 MB' },
          ],
        },
        { kind: 'file', name: 'Huldra.glb', path: 'Huldra.glb', note: '48 MB' },
      ],
    },
    {
      kind: 'dir',
      name: 'project-x',
      path: 'store:project-x',
      variant: 'section',
      icon: dbIcon,
      children: [{ kind: 'file', name: 'Jacket.rvm', path: 'x/Jacket.rvm', note: '31 MB' }],
    },
  ],
};

/** Gallery section for FileTree. */
export function FileTreeDemo() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['Huldra.glb']));
  // collapse/expand-all are edge-triggered counters: bump to act, the tree
  // keeps owning the per-folder state in between
  const [collapseAll, setCollapseAll] = useState(0);
  const [expandAll, setExpandAll] = useState(0);
  return (
    <Section
      title="FileTree"
      note="A file-tree picker with desktop-file-manager selection: click, Ctrl+click to toggle, Shift+click for a range over the visible rows; clicking a folder (de)selects everything under it. Optional drag-and-drop moves and a right-click folder menu via the onMove/onAddFolder/… callbacks. A dir with variant: 'section' renders as a dimmed category band (grouping chrome, e.g. a store — here 'project-x' starts collapsed via defaultCollapsed); icon overrides the folder icon. collapseAllSignal / expandAllSignal are counters the parent bumps (a toolbar button, a hotkey) to fold or open every dir at once — the tree keeps owning the per-folder state in between."
      props={['FileTreeProps', 'TreeDir', 'TreeFile', 'TreeNode']}
      code={`function ModelPicker() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tree: TreeDir = { kind: 'dir', name: '', path: '', children: [
    { kind: 'dir', name: 'main', path: 'store:main', variant: 'section',
      children: [
        { kind: 'file', name: 'Huldra.glb', path: 'Huldra.glb', note: '48 MB' },
      ] },
  ] };
  const [collapseAll, setCollapseAll] = useState(0); // bump = collapse every dir
  return <>
    <Button onClick={() => setCollapseAll((n) => n + 1)}>Collapse all</Button>
    <FileTree root={tree} selected={selected} onSelect={setSelected}
      defaultCollapsed={['store:project-x']} collapseAllSignal={collapseAll} />
  </>;
}`}
    >
      <div className="mb-2 flex gap-2">
        <Button onClick={() => setCollapseAll((n) => n + 1)}>Collapse all</Button>
        <Button onClick={() => setExpandAll((n) => n + 1)}>Expand all</Button>
      </div>
      <FileTree
        root={demoTree}
        selected={selected}
        onSelect={setSelected}
        defaultCollapsed={['store:project-x']}
        collapseAllSignal={collapseAll}
        expandAllSignal={expandAll}
      />
      <p className="m-0 mt-2 text-slate-500 text-xs">{selected.size} selected</p>
    </Section>
  );
}
