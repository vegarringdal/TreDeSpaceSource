import { IconFocusCentered } from '@tabler/icons-react';
import { RibbonButton, RibbonNumber, RibbonSection } from '@treDeSpaceUI/widgets';
import { AXES } from './clippingPlaneAxes';
import { ribbonClippingPlaneActions as act, planeAxisPosition } from './ribbonClippingPlane.actions';
import { ribbonClippingPlaneState } from './ribbonClippingPlane.state';

// room for "-999999.9 m" plus the − / + steppers
const POSITION_FIELD_WIDTH = 144;

/** Per-axis plane position — the plane's WORLD coordinate along its axis, so
 *  a value can be typed straight from a drawing — with Center, and the
 *  position step size. */
export function ClipPlanePositionGroups() {
  const s = ribbonClippingPlaneState.use();

  return (
    <>
      <RibbonSection title="Position">
        {AXES.map(({ axis }) => (
          <RibbonButton
            key={axis}
            size="mini"
            icon={<IconFocusCentered />}
            label="Center"
            tooltip={`Center the ${axis.toUpperCase()} plane on the last clicked point`}
            disabled={!s[axis].enabled}
            onClick={() => act.center(axis)}
          />
        ))}
        {AXES.map(({ axis }) => (
          <RibbonNumber
            key={axis}
            size="mini"
            unit="m"
            fieldWidth={POSITION_FIELD_WIDTH}
            step={s[axis].step}
            precision={1}
            value={planeAxisPosition(axis, s[axis])}
            decShortcut={`clip.plane.${axis}.position.dec`}
            incShortcut={`clip.plane.${axis}.position.inc`}
            onChange={(v) => act.setAxisPosition(axis, v)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Position Step">
        {AXES.map(({ axis }) => (
          <RibbonNumber
            key={axis}
            size="mini"
            unit="m"
            min={0.1}
            step={0.1}
            precision={2}
            value={s[axis].step}
            decShortcut={`clip.plane.${axis}.step.dec`}
            incShortcut={`clip.plane.${axis}.step.inc`}
            onChange={(v) => act.setStep(axis, v)}
          />
        ))}
      </RibbonSection>
    </>
  );
}
