import { ParamListEditor } from '@treDeSpaceUI/widgets';
import type { OverlayParam, OverlayParamType } from '../../../lib/overlay/overlayTypes';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';

const TYPES: readonly { value: OverlayParamType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'richText', label: 'Rich text' },
  { value: 'image', label: 'Image' },
  { value: 'color', label: 'Colour' },
  { value: 'number', label: 'Number' },
  { value: 'toggle', label: 'Toggle' },
];

/** A fresh parameter of a type with its default value. */
function makeParam(type: OverlayParamType, key: string): OverlayParam {
  switch (type) {
    case 'text':
    case 'richText':
      return { key, label: key, type, default: '' };
    case 'image':
      return { key, label: key, type, default: null };
    case 'color':
      return { key, label: key, type, default: '#ffffff' };
    case 'number':
      return { key, label: key, type, default: 0 };
    case 'toggle':
      return { key, label: key, type, default: true };
  }
}

/** The component's parameters (what each instance fills in). */
export function ParamsEditor({ params }: { params: OverlayParam[] }) {
  return <ParamListEditor value={params} types={TYPES} make={makeParam} onChange={overlayEditorActions.setParams} />;
}
