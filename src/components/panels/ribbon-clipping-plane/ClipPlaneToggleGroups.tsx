import { RibbonButton, RibbonSection, RibbonSlot } from '@treDeSpaceUI/widgets';
import { AXES } from './clippingPlaneAxes';
import { ribbonClippingPlaneActions as act } from './ribbonClippingPlane.actions';
import { ribbonClippingPlaneState } from './ribbonClippingPlane.state';

/** The plane legend column and the per-axis enable / helper / gizmo toggles. */
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
            tooltip={`Show the ${axis.toUpperCase()} plane helper (the 3×3 m marker)`}
            selected={s[axis].helper}
            shortcut={`clip.plane.${axis}.helper`}
            onClick={() => act.toggleHelper(axis)}
          />
        ))}
        {AXES.map(({ axis }) => (
          <RibbonButton
            key={axis}
            size="mini"
            label="Gizmo"
            tooltip={`Show the ${axis.toUpperCase()} plane's transform tool in the viewport (move arrows, or rotation rings in Rotate mode)`}
            selected={s[axis].gizmo}
            shortcut={`clip.plane.${axis}.gizmo`}
            onClick={() => act.toggleGizmo(axis)}
          />
        ))}
      </RibbonSection>
    </>
  );
}
