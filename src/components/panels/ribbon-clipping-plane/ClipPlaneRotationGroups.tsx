import { IconArrowsUpDown, IconRestore, IconRotate } from '@tabler/icons-react';
import { RibbonButton, RibbonNumber, RibbonSection } from '@treDeSpaceUI/widgets';
import { AXES } from './clippingPlaneAxes';
import { ribbonClippingPlaneActions as act } from './ribbonClippingPlane.actions';
import { ribbonClippingPlaneState } from './ribbonClippingPlane.state';

/** Per-axis flip, rotate mode with elevation/azimuth angles, and reset-all. */
export function ClipPlaneRotationGroups() {
  const s = ribbonClippingPlaneState.use();

  return (
    <>
      <RibbonSection title="Flip">
        {AXES.map(({ axis }) => (
          <RibbonButton
            key={axis}
            size="mini"
            icon={<IconArrowsUpDown />}
            label="Flip"
            shortcut={`clip.plane.${axis}.flip`}
            onClick={() => act.flip(axis)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Rotation">
        {AXES.map(({ axis }) => (
          <RibbonButton
            key={axis}
            size="mini"
            icon={<IconRotate />}
            label="Rotate"
            selected={s[axis].rotateMode}
            shortcut={`clip.plane.${axis}.rotate`}
            onClick={() => act.rotate(axis)}
          />
        ))}
        {AXES.map(({ axis }) => (
          <RibbonNumber
            key={axis}
            size="mini"
            unit="°el"
            step={5}
            disabled={!s[axis].rotateMode}
            value={s[axis].el}
            decShortcut={`clip.plane.${axis}.el.dec`}
            incShortcut={`clip.plane.${axis}.el.inc`}
            onChange={(v) => act.setEl(axis, v)}
          />
        ))}
        {AXES.map(({ axis }) => (
          <RibbonNumber
            key={axis}
            size="mini"
            unit="°az"
            step={5}
            disabled={!s[axis].rotateMode}
            value={s[axis].az}
            decShortcut={`clip.plane.${axis}.az.dec`}
            incShortcut={`clip.plane.${axis}.az.inc`}
            onChange={(v) => act.setAz(axis, v)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Reset">
        <RibbonButton icon={<IconRestore />} label="Reset All" shortcut="clip.plane.resetAll" onClick={act.resetAll} />
      </RibbonSection>
    </>
  );
}
