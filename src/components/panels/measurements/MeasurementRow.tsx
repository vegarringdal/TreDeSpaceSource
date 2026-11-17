import {
  IconAngle,
  IconArrowAutofitHeight,
  IconChartArea,
  IconCircleDashed,
  IconMapPin,
  IconRoute,
  IconRuler,
} from '@tabler/icons-react';
import { Collapsible, TextArea } from '@treDeSpaceUI/widgets';
import { firstLine } from '../../../lib/richText';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import {
  displayName,
  type Measurement,
  type MeasureToolKind,
  valueLabel,
} from '../../../state/viewer/measurements.state';
import { RichText } from '../../shared/RichText';
import { MeasurementAxisLegs } from './MeasurementAxisLegs';
import { MeasurementRowButtons } from './MeasurementRowButtons';

const KIND_ICON: Record<MeasureToolKind, typeof IconRuler> = {
  point: IconMapPin,
  angle: IconAngle,
  line: IconRuler,
  path: IconRoute,
  area: IconChartArea,
  diameter: IconCircleDashed,
  face: IconArrowAutofitHeight,
};

/** One measurement's list row: the name (multiline, **bold** allowed — the
 *  header shows its first line with the bold rendered, the editor the whole
 *  text), the row toggles, and the ΔX/ΔY/ΔZ leg controls for line/path
 *  measurements. */
export function MeasurementRow({ m, precision }: { m: Measurement; precision: number }) {
  const Icon = KIND_ICON[m.kind];
  const staircase = m.kind === 'line' || m.kind === 'path';

  return (
    // native shapes_panel-style section bar: name + live value aside
    <Collapsible
      key={m.id}
      title={<RichText text={firstLine(displayName(m))} className="min-w-0 truncate" />}
      aside={<span className="font-mono text-amber-300">{valueLabel(m, precision)}</span>}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Icon size={16} className="shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <TextArea
              value={m.label}
              onChange={(v) => act.setLabel(m.id, v)}
              rows={1}
              clearable={false}
              placeholder="(name — Enter for a new line, **bold**)"
            />
          </div>
          <MeasurementRowButtons m={m} />
        </div>
        {staircase && <MeasurementAxisLegs m={m} />}
      </div>
    </Collapsible>
  );
}
