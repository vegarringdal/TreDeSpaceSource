import { NumberInput, SegmentedControl } from '@treDeSpaceUI/widgets';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../../../lib/overlay/overlayStyle';
import { AUTO_MAX_WIDTH } from '../../../lib/overlay/overlayTemplate';
import type { OverlayComponent } from '../../../lib/overlay/overlayTypes';
import { overlayEditorActions, TEXT_SCALE_STEP } from '../../../state/animation/overlayEditor.actions';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const WIDTH_MODES = [
  {
    value: 'auto',
    label: 'Auto',
    tooltip: 'As wide as the content and its padding, between Min and Max',
    shortcut: 'overlay.card.widthMode.auto',
  },
  { value: 'px', label: 'Fixed', tooltip: 'Always this wide', shortcut: 'overlay.card.widthMode.px' },
] as const;

const DEFAULT_FIXED_W = 600;

type Size = OverlayComponent['size'];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function setSize(patch: Partial<Size>): void {
  overlayEditorActions.change((c) => ({ ...c, size: { ...c.size, ...patch } }));
}

/** The card's own width (the frame every block sits in): auto between a
 *  min and a max, or fixed — and the design's text size. */
export function CardSizeFields({ size, textScale }: { size: Size; textScale: number }) {
  const isAuto = size.width === 'auto';

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center gap-1">
        <span className="w-16 text-[11px] text-slate-400">Width</span>
        <SegmentedControl
          size="sm"
          value={isAuto ? 'auto' : 'px'}
          options={WIDTH_MODES}
          onChange={(m) => setSize({ width: m === 'auto' ? 'auto' : DEFAULT_FIXED_W })}
        />
        {typeof size.width === 'number' && (
          <NumberInput
            tooltip="The card's width in px (at 1080p)"
            decShortcut="overlay.card.width.dec"
            incShortcut="overlay.card.width.inc"
            className="w-28"
            value={size.width}
            min={40}
            max={4000}
            step={10}
            unit="px"
            onChange={(width) => setSize({ width })}
          />
        )}
      </div>
      {isAuto && (
        <div className="flex items-center gap-1">
          <span className="w-16 text-[11px] text-slate-400">Min / max</span>
          <NumberInput
            tooltip="The card is never narrower than this (px at 1080p)"
            decShortcut="overlay.card.minWidth.dec"
            incShortcut="overlay.card.minWidth.inc"
            className="w-28"
            value={size.minWidth ?? 0}
            min={0}
            max={4000}
            step={10}
            unit="px"
            onChange={(minWidth) => setSize({ minWidth })}
          />
          <NumberInput
            tooltip="Longer text wraps at this width (px at 1080p)"
            decShortcut="overlay.card.maxWidth.dec"
            incShortcut="overlay.card.maxWidth.inc"
            className="w-28"
            value={size.maxWidth ?? AUTO_MAX_WIDTH}
            min={40}
            max={4000}
            step={10}
            unit="px"
            onChange={(maxWidth) => setSize({ maxWidth })}
          />
        </div>
      )}
      <NumberInput
        tooltip="Every text in the design × this (1 = sizes as set per block). A placed card's own Text size multiplies on top"
        className="w-44"
        label="Text size"
        labelPosition="left"
        labelWidth={64}
        value={textScale}
        min={TEXT_SCALE_MIN}
        max={TEXT_SCALE_MAX}
        step={TEXT_SCALE_STEP}
        unit="×"
        decShortcut="overlay.textScale.dec"
        incShortcut="overlay.textScale.inc"
        onChange={(v) => overlayEditorActions.setTextScale(v)}
      />
    </div>
  );
}
