// Overlay Editor panel (DESIGN.md › Animation): Library | Inspector.
// The live preview is its own panel (Overlay Preview) so it stays in view
// beside the editor. Edits a working copy; Save puts it in the library
// (version bump) and every instance restyles.
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconDeviceFloppy,
  IconLayersSubtract,
  IconLayoutBoardSplit,
} from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { useElementWidth } from '@treDeSpaceUI/lib';
import { Button, Collapsible, EmptyState, TextInput, VerticalTabs } from '@treDeSpaceUI/widgets';
import { useRef } from 'react';
import { autoTheme } from '../../../lib/overlay/overlayPresets';
import type { OverlayBlock } from '../../../lib/overlay/overlayTypes';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { libraryTheme } from '../../../state/overlayComponents/overlayComponents.actions';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { togglePanelById } from '../ribbon-panels/panelToggle';
import { settingsState } from '../settings/settings.state';
import { BlockInspector } from './BlockInspector';
import { CardSizeFields } from './CardSizeFields';
import { OverlayLibrary } from './OverlayLibrary';
import { OverlayOutline } from './OverlayOutline';
import { ParamsEditor } from './ParamsEditor';
import { ThemeTokens } from './ThemeTokens';

/** Narrower than this, library and inspector become tabs. */
const WIDE_PX = 520;

function findBlock(b: OverlayBlock, id: string | null): OverlayBlock | null {
  if (!id || b.id === id) {
    return b;
  }
  return b.kind === 'box' ? (b.children.map((c) => findBlock(c, id)).find((x) => x && x.id === id) ?? null) : null;
}

/** The overlay component designer. */
export function OverlayEditor() {
  useMinSize(280, 260);
  const s = overlayEditorState.use();
  const ref = useRef<HTMLDivElement>(null);
  const wide = useElementWidth(ref) >= WIDE_PX;
  const w = s.working;
  const app = settingsState.useSelect((x) => x.theme);
  const themes = overlayLibraryState.useSelect((x) => x.themes);
  const theme = s.theme ? libraryTheme(s.theme) : autoTheme(app, themes);
  const block = w ? findBlock(w.root, s.selectedBlock) : null;

  const library = <OverlayLibrary theme={s.theme} onTheme={overlayEditorActions.setTheme} />;
  const inspector = w ? (
    <div className="flex flex-col">
      <div className="p-2">
        <TextInput
          tooltip="The component's name in the library"
          label="Name"
          labelPosition="left"
          labelWidth={48}
          value={w.name}
          onChange={(name) => overlayEditorActions.change((c) => ({ ...c, name }))}
        />
      </div>
      <Collapsible title="Card size" defaultOpen aside={w.size.width === 'auto' ? 'auto' : `${w.size.width} px`}>
        <CardSizeFields size={w.size} textScale={w.textScale ?? 1} />
      </Collapsible>
      <Collapsible title="Outline" defaultOpen>
        <OverlayOutline component={w} />
      </Collapsible>
      <Collapsible title={`Block${block ? ` · ${block.kind}` : ''}`} defaultOpen>
        {block && <BlockInspector component={w} block={block} />}
      </Collapsible>
      <Collapsible title="Parameters" aside={String(w.params.length)}>
        <ParamsEditor params={w.params} />
      </Collapsible>
      {theme && (
        <Collapsible title={`Theme · ${theme.name}${s.theme ? '' : ' (auto)'}`}>
          <ThemeTokens theme={theme} />
        </Collapsible>
      )}
    </div>
  ) : (
    <EmptyState layout="center" icon={<IconLayersSubtract size={26} />}>
      Pick a component in the library, or New from a preset.
    </EmptyState>
  );

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col">
      <div ref={ref} className="flex shrink-0 items-center gap-1 border-slate-800 border-b p-1.5">
        <Button
          iconOnly
          size="sm"
          icon={<IconArrowBackUp />}
          disabled={s.undoDepth === 0}
          tooltip="Undo"
          shortcut="overlay.undo"
          onClick={overlayEditorActions.undo}
        />
        <Button
          iconOnly
          size="sm"
          icon={<IconArrowForwardUp />}
          disabled={s.redoDepth === 0}
          tooltip="Redo"
          shortcut="overlay.redo"
          onClick={overlayEditorActions.redo}
        />
        <Button
          size="sm"
          icon={<IconLayoutBoardSplit />}
          tooltip="Show / hide the live preview (its own panel, so it stays in view while you edit)"
          shortcut="panel.toggle.overlayPreview"
          onClick={() => togglePanelById('overlayPreview')}
        >
          Preview
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<IconDeviceFloppy />}
          disabled={!w || !s.dirty}
          tooltip="Save to your library — every overlay using it is restyled"
          shortcut="overlay.save"
          onClick={overlayEditorActions.save}
          className="ml-auto"
        >
          Save
        </Button>
      </div>
      {wide ? (
        <div className="flex min-h-0 flex-1">
          <div className="w-48 shrink-0 overflow-y-auto border-slate-800 border-r">{library}</div>
          <div className="min-w-0 flex-1 overflow-y-auto">{inspector}</div>
        </div>
      ) : (
        <VerticalTabs
          // opening another component jumps to its inspector
          key={w?.id ?? 'none'}
          className="min-h-0 flex-1"
          defaultValue={w ? 'inspector' : 'library'}
          tabs={[
            { id: 'library', label: 'Library', content: library },
            { id: 'inspector', label: 'Inspector', content: inspector },
          ]}
        />
      )}
    </PanelBody>
  );
}
