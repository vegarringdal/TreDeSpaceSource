import { Checkbox, ColorSelect, NumberInput, SegmentedControl } from '@treDeSpaceUI/widgets';
import type { ObjectKey } from '../../../lib/animation/types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type Instant = Pick<ObjectKey, 'visible' | 'opacity' | 'color'>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const LABEL_W = 56;
const DEFAULT_KEY_COLOR = '#ef4444';

const VISIBLE = [
  { value: 'same', label: 'As before', tooltip: 'This key does not change it', shortcut: 'animation.key.visible.same' },
  { value: 'shown', label: 'Shown', tooltip: 'Shown from this key on', shortcut: 'animation.showFromHere' },
  { value: 'hidden', label: 'Hidden', tooltip: 'Hidden from this key on', shortcut: 'animation.hideFromHere' },
] as const;

const COLOR = [
  { value: 'same', label: 'As before', tooltip: 'This key does not change it', shortcut: 'animation.key.color.same' },
  {
    value: 'own',
    label: 'Own',
    tooltip: "The item's own colour from this key on",
    shortcut: 'animation.ownColorFromHere',
  },
  { value: 'set', label: 'Colour', tooltip: 'This colour from this key on', shortcut: 'animation.colorFromHere' },
] as const;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const visibleMode = (v: boolean | undefined) => (v === undefined ? 'same' : v ? 'shown' : 'hidden');
const colorMode = (c: string | null | undefined) => (c === undefined ? 'same' : c === null ? 'own' : 'set');

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------

/** A key's instant values — visible, opacity, colour — each "as before"
 *  (the key leaves it) or set from this key on. */
export function KeyInstantFields({ value, onChange }: { value: Instant; onChange: (patch: Instant) => void }) {
  const handleVisible = (m: (typeof VISIBLE)[number]['value']) =>
    onChange({ visible: m === 'same' ? undefined : m === 'shown' });
  const handleColor = (m: (typeof COLOR)[number]['value']) =>
    onChange({ color: m === 'same' ? undefined : m === 'own' ? null : (value.color ?? DEFAULT_KEY_COLOR) });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
          Visible
        </span>
        <SegmentedControl
          size="sm"
          grow
          value={visibleMode(value.visible)}
          options={VISIBLE}
          onChange={handleVisible}
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
          Colour
        </span>
        <SegmentedControl size="sm" grow value={colorMode(value.color)} options={COLOR} onChange={handleColor} />
      </div>
      {typeof value.color === 'string' && (
        <ColorSelect
          label="Key colour"
          labelPosition="split"
          tooltip="The colour from this key on"
          value={value.color}
          onChange={(color) => onChange({ color })}
        />
      )}
      <Checkbox
        tooltip="Set how opaque it is from this key on (otherwise as before)"
        shortcut="animation.key.opacity"
        label="Opacity from this key"
        checked={value.opacity !== undefined}
        onChange={(on) => onChange({ opacity: on ? 0.5 : undefined })}
      />
      {value.opacity !== undefined && (
        <NumberInput
          tooltip="How opaque from this key on (0 = invisible, 1 = solid)"
          decShortcut="animation.key.opacity.dec"
          incShortcut="animation.key.opacity.inc"
          label="Opacity"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={value.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => onChange({ opacity })}
        />
      )}
    </div>
  );
}
