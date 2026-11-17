import { Checkbox, ColorSelect, ImagePicker, NumberInput, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { paramValue } from '../../../lib/overlay/overlayBindings';
import { OVERLAY_IMAGE_MAX_BYTES } from '../../../lib/overlay/overlaySafety';
import type { OverlayComponent, OverlayValue } from '../../../lib/overlay/overlayTypes';

/** A value form generated from a component's params — an instance's values
 *  in the inspector, the sample values in the Overlay Preview. */
export function OverlayValueFields({
  component,
  values,
  onChange,
}: {
  component: OverlayComponent;
  values: Readonly<Record<string, OverlayValue>>;
  onChange: (key: string, value: OverlayValue) => void;
}) {
  if (component.params.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      {component.params.map((p) => {
        const v = paramValue(p, values);
        const set = (value: OverlayValue) => onChange(p.key, value);
        switch (p.type) {
          case 'text':
            return (
              <TextInput
                tooltip={p.label}
                key={p.key}
                label={p.label}
                labelPosition="left"
                labelWidth={56}
                value={String(v ?? '')}
                onChange={set}
              />
            );
          case 'richText':
            return (
              <TextArea key={p.key} label={`${p.label} (**bold**)`} rows={2} value={String(v ?? '')} onChange={set} />
            );
          case 'number':
            return (
              <NumberInput
                tooltip={p.label}
                key={p.key}
                label={p.label}
                labelPosition="left"
                labelWidth={56}
                value={typeof v === 'number' ? v : 0}
                step={1}
                onChange={set}
              />
            );
          case 'toggle':
            return <Checkbox tooltip={p.label} key={p.key} label={p.label} checked={v === true} onChange={set} />;
          case 'color':
            return (
              <ColorSelect
                tooltip={p.label}
                key={p.key}
                label={p.label}
                labelPosition="left"
                labelWidth={56}
                value={String(v ?? '#ffffff')}
                onChange={set}
              />
            );
          case 'image':
            return (
              <ImagePicker
                key={p.key}
                label={p.label}
                labelPosition="left"
                labelWidth={56}
                value={typeof v === 'string' ? v : null}
                maxBytes={OVERLAY_IMAGE_MAX_BYTES}
                onChange={set}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
