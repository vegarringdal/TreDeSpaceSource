import { IconPlus, IconTrash } from '@tabler/icons-react';
import { Button, Collapsible, Menu, TreeView } from '@treDeSpaceUI/widgets';
import { OVERLAY_PRESETS } from '../../../lib/overlay/overlayPresets';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { overlayLibraryActions } from '../../../state/overlayComponents/overlayComponents.actions';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { useMenuAnchor } from '../shared/useMenuAnchor';
import { OverlayLibraryFiles } from './OverlayLibraryFiles';

/** The user's components and themes; New ▾ always starts from a preset. */
export function OverlayLibrary({ theme, onTheme }: { theme: string | null; onTheme: (id: string) => void }) {
  const lib = overlayLibraryState.use();
  const working = overlayEditorState.use().working;
  const menu = useMenuAnchor('overlay.menu.new');

  return (
    <div className="flex flex-col">
      <Collapsible title="Components" aside={String(lib.components.length)} defaultOpen>
        <TreeView
          rows={lib.components.map((c) => ({
            key: c.id,
            depth: 0,
            label: c.name,
            selected: working?.id === c.id,
            muted: c.id.startsWith('preset.'),
            trailing: c.id.startsWith('preset.') ? (
              <span className="text-slate-600">preset</span>
            ) : (
              <span className="text-slate-600">v{c.version}</span>
            ),
          }))}
          onRowClick={(row) => overlayEditorActions.editComponent(row.key)}
        />
        <div className="flex flex-wrap gap-1">
          <span ref={menu.wrap} className="inline-flex">
            <Button
              size="sm"
              icon={<IconPlus />}
              tooltip="New component from a preset (ALT 1311 makes one from the Step card straight away)"
              shortcut="overlay.menu.new"
              onClick={menu.open}
            >
              New ▾
            </Button>
          </span>
          {working && !working.id.startsWith('preset.') && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconTrash />}
              tooltip="Remove this component from the library"
              shortcut="overlay.component.remove"
              onClick={() => overlayLibraryActions.removeComponent(working.id)}
            />
          )}
          <OverlayLibraryFiles />
        </div>
      </Collapsible>
      <Collapsible title="Themes" aside={String(lib.themes.length)}>
        <TreeView
          rows={lib.themes.map((t) => ({ key: t.id, depth: 0, label: t.name, selected: theme === t.id }))}
          onRowClick={(row) => onTheme(row.key)}
        />
      </Collapsible>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          ...OVERLAY_PRESETS.map((p) => ({
            id: p.id,
            label: `From "${p.name}"`,
            onSelect: () => overlayEditorActions.newFrom(p, p.name),
          })),
          working
            ? { id: 'copy', label: `Copy of "${working.name}"`, onSelect: () => overlayEditorActions.newFrom(working) }
            : null,
        ]}
      />
    </div>
  );
}
