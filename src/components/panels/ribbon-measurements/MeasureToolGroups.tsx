import {
  IconAngle,
  IconArrowAutofitHeight,
  IconArrowsExchange,
  IconBan,
  IconChartArea,
  IconCircleDashed,
  IconMapPin,
  IconRoute,
  IconRuler,
} from '@tabler/icons-react';
import { Button, RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { type MeasureLock, measurementsState } from '../../../state/viewer/measurements.state';
import { ribbonMeasurementsActions as act } from './ribbonMeasurements.actions';
import { ribbonMeasurementsState } from './ribbonMeasurements.state';

const TOOLS = [
  { id: 'off', label: 'Off', Icon: IconBan },
  { id: 'point', label: 'Point', Icon: IconMapPin },
  { id: 'line', label: 'Line', Icon: IconRuler },
  { id: 'path', label: 'Path', Icon: IconRoute },
  { id: 'area', label: 'Area', Icon: IconChartArea },
  { id: 'diameter', label: 'Diameter', Icon: IconCircleDashed },
  { id: 'angle', label: 'Angle', Icon: IconAngle },
  { id: 'face', label: 'Face', Icon: IconArrowAutofitHeight },
] as const;

// column-major 2×3 grid: none/perp/parallel | x/y/z
const LOCKS: { id: MeasureLock; label: string; tip: string }[] = [
  { id: 'none', label: 'None', tip: 'No placement lock' },
  { id: 'x', label: 'X-axis', tip: 'Next point moves only along X from the previous point' },
  { id: 'perp', label: 'Perpendicular', tip: "Next point moves straight out along the last point's surface normal" },
  { id: 'y', label: 'Y-axis', tip: 'Next point moves only along Y from the previous point' },
  { id: 'parallel', label: 'Parallel', tip: "Next point stays in the last point's surface plane" },
  { id: 'z', label: 'Z-axis', tip: 'Next point moves only along Z from the previous point' },
];

/** Measure tool selection and the point-placement lock grid. */
export function MeasureToolGroups() {
  const s = ribbonMeasurementsState.use();
  const { lock } = measurementsState.use();

  return (
    <>
      <RibbonSection title="Measure tool">
        {TOOLS.map(({ id, label, Icon }) => (
          <RibbonButton
            key={id}
            icon={<Icon />}
            label={label}
            selected={s.tool === id}
            shortcut={`measure.tool.${id}`}
            onClick={() => act.setTool(id)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Options">
        <RibbonButton
          icon={<IconArrowsExchange />}
          label="Auto disable"
          selected={s.offOnRibbonSwitch}
          tooltip="Automatically turn the measure tool Off when you leave this ribbon: switching to another ribbon tab, or changing layout via the Layout ribbon or the F-keys. Keeps a measuring mode from staying armed while you work elsewhere, where every click would otherwise place a measurement point. Turn it off to keep the tool armed across ribbon and layout switches. Default on."
          shortcut="measure.offOnSwitch"
          onClick={() => act.toggleOffOnRibbonSwitch()}
        />
      </RibbonSection>

      <RibbonSection title="Lock">
        <div className="grid grid-cols-2 gap-0.5">
          {LOCKS.map(({ id, label, tip }) => (
            <Button
              key={id}
              className="h-auto min-h-5 justify-start px-1.5 py-0.5 text-[11px]"
              active={lock === id}
              tooltip={tip}
              shortcut={`measure.lock.${id}`}
              onClick={() => act.setLock(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </RibbonSection>
    </>
  );
}
