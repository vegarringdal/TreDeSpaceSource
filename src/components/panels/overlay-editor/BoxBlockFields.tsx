import { NumberInput, SegmentedControl, Select } from '@treDeSpaceUI/widgets';
import type { OverlayBlock } from '../../../lib/overlay/overlayTypes';
import { BoxStyleFields } from './BoxStyleFields';

type Box = Extract<OverlayBlock, { kind: 'box' }>;

const DIRS = [
  { value: 'col', label: 'Column', tooltip: 'Children stacked top to bottom', shortcut: 'overlay.box.dir.col' },
  { value: 'row', label: 'Row', tooltip: 'Children side by side', shortcut: 'overlay.box.dir.row' },
] as const;
const ALIGNS = (['start', 'center', 'end', 'stretch'] as const).map((v) => ({ value: v, label: v }));
const JUSTIFY = (['start', 'center', 'end', 'between'] as const).map((v) => ({ value: v, label: v }));

/** A box block: flex layout (direction, gap, align, justify) + box style. */
export function BoxBlockFields({ block, onChange }: { block: Box; onChange: (b: Box) => void }) {
  const layout = (patch: Partial<Box['layout']>) => onChange({ ...block, layout: { ...block.layout, ...patch } });

  return (
    <>
      <div className="flex items-center gap-1">
        <span className="w-16 text-[11px] text-slate-400">Layout</span>
        <SegmentedControl size="sm" value={block.layout.dir} options={DIRS} onChange={(dir) => layout({ dir })} />
      </div>
      <NumberInput
        tooltip="Space between the children (px)"
        decShortcut="overlay.box.gap.dec"
        incShortcut="overlay.box.gap.inc"
        label="Gap"
        labelPosition="left"
        labelWidth={64}
        value={block.layout.gap}
        min={0}
        max={200}
        step={1}
        unit="px"
        onChange={(gap) => layout({ gap })}
      />
      <Select
        tooltip="How the children line up across the box"
        label="Align"
        labelPosition="left"
        labelWidth={64}
        value={block.layout.align}
        options={ALIGNS}
        clearable={false}
        onChange={(align) => align && layout({ align })}
      />
      <Select
        tooltip="How the children spread along the box"
        label="Justify"
        labelPosition="left"
        labelWidth={64}
        value={block.layout.justify}
        options={JUSTIFY}
        clearable={false}
        onChange={(justify) => justify && layout({ justify })}
      />
      <BoxStyleFields style={block.style} onChange={(style) => onChange({ ...block, style })} />
    </>
  );
}
