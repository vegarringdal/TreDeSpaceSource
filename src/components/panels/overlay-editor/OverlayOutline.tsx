import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { Button, Menu, TreeView, type TreeViewRow } from '@treDeSpaceUI/widgets';
import type { OverlayBlock, OverlayComponent } from '../../../lib/overlay/overlayTypes';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { useMenuAnchor } from '../shared/useMenuAnchor';

const KINDS: readonly OverlayBlock['kind'][] = ['box', 'text', 'image', 'icon', 'divider', 'progress'];

function label(b: OverlayBlock): string {
  if (b.kind === 'text') {
    return `text · ${b.text.slice(0, 24)}`;
  }
  if (b.kind === 'icon') {
    return `icon · ${b.icon}`;
  }
  if (b.kind === 'box') {
    return `box · ${b.layout.dir}`;
  }
  return b.kind;
}

function flatten(b: OverlayBlock, depth: number, out: TreeViewRow[], selected: string | null): void {
  out.push({
    key: b.id,
    depth,
    label: label(b),
    selected: selected === b.id,
    muted: !!b.showIf,
    tooltip: b.showIf ? `shown if {{${b.showIf}}}` : undefined,
  });
  if (b.kind === 'box') {
    for (const c of b.children) {
      flatten(c, depth + 1, out, selected);
    }
  }
}

/** The block tree: select, add (inside the selected box), move, remove. */
export function OverlayOutline({ component }: { component: OverlayComponent }) {
  const sel = overlayEditorState.use().selectedBlock;
  const menu = useMenuAnchor('overlay.menu.block');
  const rows: TreeViewRow[] = [];
  flatten(component.root, 0, rows, sel);

  return (
    <div className="flex flex-col gap-1">
      <TreeView rows={rows} onRowClick={(row) => overlayEditorActions.select(row.key)} />
      <div className="flex gap-0.5">
        <span ref={menu.wrap} className="inline-flex">
          <Button
            tooltip="Add a block inside the selected one"
            size="sm"
            icon={<IconPlus />}
            shortcut="overlay.menu.block"
            onClick={menu.open}
          >
            Block ▾
          </Button>
        </span>
        <Button
          iconOnly
          size="sm"
          icon={<IconArrowUp />}
          disabled={!sel}
          tooltip="Move up"
          shortcut="overlay.block.up"
          onClick={() => sel && overlayEditorActions.moveBlock(sel, -1)}
        />
        <Button
          iconOnly
          size="sm"
          icon={<IconArrowDown />}
          disabled={!sel}
          tooltip="Move down"
          shortcut="overlay.block.down"
          onClick={() => sel && overlayEditorActions.moveBlock(sel, 1)}
        />
        <Button
          iconOnly
          size="sm"
          icon={<IconTrash />}
          disabled={!sel || sel === component.root.id}
          tooltip="Remove block"
          shortcut="overlay.block.remove"
          onClick={() => sel && overlayEditorActions.removeBlock(sel)}
        />
      </div>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={KINDS.map((k) => ({
          id: k,
          label: k,
          shortcut: k === 'text' ? 'overlay.addBlock' : `overlay.addBlock.${k}`,
          onSelect: () => overlayEditorActions.addBlock(k),
        }))}
      />
    </div>
  );
}
