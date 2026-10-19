// The Overlay Preview's sample content: the component's params and the
// context placeholders, so the card can be checked with real text. Sample
// values are preview-only — they are never saved with the component.
import { Collapsible, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import type { OverlayComponent } from '../../../lib/overlay/overlayTypes';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { OverlayValueFields } from '../animation/OverlayValueFields';

const LABEL_W = 72;

/** Editable sample values for the preview. */
export function PreviewSampleFields({ component }: { component: OverlayComponent }) {
  const s = overlayEditorState.use();
  const sc = s.sampleContext;

  return (
    <div className="flex flex-col">
      <Collapsible title="Sample values" aside={String(component.params.length)} defaultOpen>
        {component.params.length === 0 ? (
          <span className="text-[11px] text-slate-500">This component has no parameters.</span>
        ) : (
          <OverlayValueFields component={component} values={s.sample} onChange={overlayEditorActions.setSampleValue} />
        )}
      </Collapsible>
      <Collapsible title="Sample step" defaultOpen>
        <div className="flex flex-col gap-1">
          <TextInput
            label="Step name"
            labelPosition="left"
            labelWidth={LABEL_W}
            tooltip="What {{step.name}} shows in the preview"
            value={sc.stepName}
            onChange={(stepName) => overlayEditorActions.setSampleContext({ stepName })}
          />
          <TextArea
            label="Step text (**bold**)"
            rows={2}
            tooltip="What {{step.text}} shows in the preview"
            value={sc.stepText}
            onChange={(stepText) => overlayEditorActions.setSampleContext({ stepText })}
          />
          <TextInput
            label="Object"
            labelPosition="left"
            labelWidth={LABEL_W}
            tooltip="What {{object.name}} shows in the preview"
            value={sc.objectName}
            onChange={(objectName) => overlayEditorActions.setSampleContext({ objectName })}
          />
        </div>
      </Collapsible>
    </div>
  );
}
