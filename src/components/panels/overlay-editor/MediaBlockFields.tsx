import { IconSelect, ImagePicker, SegmentedControl, TemplateTextInput, TextInput } from '@treDeSpaceUI/widgets';
import { OVERLAY_ICONS } from '../../../lib/overlay/overlayIcons';
import { isSafeImage, OVERLAY_IMAGE_MAX_BYTES } from '../../../lib/overlay/overlaySafety';
import type { OverlayBlock } from '../../../lib/overlay/overlayTypes';
import { BoxStyleFields } from './BoxStyleFields';
import { TextStyleFields } from './TextStyleFields';

type Media = Extract<OverlayBlock, { kind: 'image' | 'icon' | 'divider' | 'progress' }>;

const FITS = [
  {
    value: 'contain',
    label: 'Contain',
    tooltip: 'The whole image, inside the box',
    shortcut: 'overlay.media.fit.contain',
  },
  { value: 'cover', label: 'Cover', tooltip: 'Fill the box, cropping the image', shortcut: 'overlay.media.fit.cover' },
] as const;

const ICONS = OVERLAY_ICONS.map((i) => ({
  name: i.name,
  label: i.label,
  node: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {i.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  ),
}));

/** Image / icon / divider / progress block fields. */
export function MediaBlockFields({
  block,
  placeholders,
  onChange,
}: {
  block: Media;
  placeholders: readonly { key: string; label: string }[];
  onChange: (b: OverlayBlock) => void;
}) {
  switch (block.kind) {
    case 'image':
      return (
        <>
          <TextInput
            tooltip="Image address (https, or a data URL)"
            label="Source"
            labelPosition="left"
            labelWidth={64}
            value={isSafeImage(block.src) ? '(embedded image)' : block.src}
            placeholder="{{image}}"
            onChange={(src) => onChange({ ...block, src })}
          />
          <ImagePicker
            label="Or embed"
            labelPosition="left"
            labelWidth={64}
            value={isSafeImage(block.src) ? block.src : null}
            maxBytes={OVERLAY_IMAGE_MAX_BYTES}
            onChange={(src) => onChange({ ...block, src: src ?? '' })}
          />
          <SegmentedControl
            size="sm"
            value={block.fit}
            options={FITS}
            onChange={(fit) => onChange({ ...block, fit })}
          />
          <BoxStyleFields style={block.style} onChange={(style) => onChange({ ...block, style })} />
        </>
      );
    case 'icon':
      return (
        <>
          <IconSelect value={block.icon} icons={ICONS} onChange={(icon) => onChange({ ...block, icon })} />
          <TextStyleFields style={block.style} onChange={(style) => onChange({ ...block, style })} />
        </>
      );
    case 'divider':
      return (
        <BoxStyleFields style={block.style} showSize={false} onChange={(style) => onChange({ ...block, style })} />
      );
    case 'progress':
      return (
        <>
          <TemplateTextInput
            label="Value (0..1, %, or a/b)"
            value={block.value}
            placeholders={placeholders}
            onChange={(value) => onChange({ ...block, value })}
          />
          <BoxStyleFields style={block.style} onChange={(style) => onChange({ ...block, style })} />
        </>
      );
  }
}
