import { Checkbox, Select, TemplateTextInput } from '@treDeSpaceUI/widgets';
import { CONTEXT_PLACEHOLDERS } from '../../../lib/overlay/overlayBindings';
import type { OverlayBlock, OverlayComponent } from '../../../lib/overlay/overlayTypes';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { BoxBlockFields } from './BoxBlockFields';
import { MediaBlockFields } from './MediaBlockFields';
import { TextStyleFields } from './TextStyleFields';

/** Editor of the selected block: content, layout and style per kind, plus
 *  "shown if" (hide when a toggle is off or a text is empty). */
export function BlockInspector({ component, block }: { component: OverlayComponent; block: OverlayBlock }) {
  const set = (b: OverlayBlock) => overlayEditorActions.updateBlock(block.id, () => b);
  const placeholders = [...component.params.map((p) => ({ key: p.key, label: p.label })), ...CONTEXT_PLACEHOLDERS];

  return (
    <div className="flex flex-col gap-1">
      {block.kind === 'box' && <BoxBlockFields block={block} onChange={set} />}
      {block.kind === 'text' && (
        <>
          <TemplateTextInput
            label="Text"
            multiline
            value={block.text}
            placeholders={placeholders}
            onChange={(text) => set({ ...block, text })}
          />
          <Checkbox
            tooltip="Text with **bold**, *italic* and line breaks"
            shortcut="overlay.block.richText"
            label="Rich text"
            hint="**bold** and line breaks"
            checked={block.rich}
            onChange={(rich) => set({ ...block, rich })}
          />
          <TextStyleFields style={block.style} onChange={(style) => set({ ...block, style })} />
        </>
      )}
      {block.kind !== 'box' && block.kind !== 'text' && (
        <MediaBlockFields block={block} placeholders={placeholders} onChange={set} />
      )}
      <Select
        label="Shown if"
        labelPosition="left"
        labelWidth={64}
        value={block.showIf ?? ''}
        options={[{ value: '', label: 'Always' }, ...placeholders.map((p) => ({ value: p.key, label: p.label }))]}
        clearable={false}
        tooltip="Hide this block when that toggle is off or that text is empty"
        onChange={(v) => set({ ...block, showIf: v || undefined })}
      />
    </div>
  );
}
