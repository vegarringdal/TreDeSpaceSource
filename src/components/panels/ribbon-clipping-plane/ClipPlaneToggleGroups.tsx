import { RibbonButton, RibbonSection, RibbonSlot } from '@treDeSpaceUI/widgets';
import { AXES } from './clippingPlaneAxes';
import { ribbonClippingPlaneActions as act } from './ribbonClippingPlane.actions';
import { ribbonClippingPlaneState } from './ribbonClippingPlane.state';

/** The plane legend column and the per-axis enable/helper toggles. */
export function ClipPlaneToggleGroups() {
  const s = ribbonClippingPlaneState.use();

  return (
    <>
      <RibbonSection title="Plane">
        {AXES.map(({ axis, label, dot }) => (
          <RibbonSlot key={axis} size="mini">
            <span className="flex items-center gap-1.5 px-1 text-xs leading-4">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              {label}
            </span>
          </RibbonSlot>
        ))}
      </RibbonSection>

      <RibbonSection title="Visibility">
        {AXES.map(({ axis }) => (
          <RibbonButton
            key={axis}
            size="mini"
            label="Enable"
            tooltip={`Toggle the ${axis.toUpperCase()} clipping plane`}
            selected={s[axis].enabled}
            shortcut={`clip.plane.${axis}.enable`}
            onClick={() => act.toggleEnabled(axis)}
          />
        ))}
        {AXES.map(({ axis }) => (
          <RibbonButton
            key={axis}
            size="mini"
            label="Helper"
            tooltip={`Show the ${axis.toUpperCase()} plane helper`}
            selected={s[axis].helper}
            onClick={() => act.toggleHelper(axis)}
          />
        ))}
      </RibbonSection>
    </>
  );
}
