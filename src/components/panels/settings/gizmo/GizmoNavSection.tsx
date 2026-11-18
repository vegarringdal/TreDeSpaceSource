import { Checkbox, NumberInput, RadioGroup, type RadioOption } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer, type ViewerState } from '../../../../state/viewer/viewer.state';
import { SettingsSection } from '../SettingsSection';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const STYLES: readonly RadioOption<ViewerState['gizmoStyle']>[] = [
  { value: 'balls', label: 'Axis balls', hint: 'the six axes; 45° snap dots show on hover' },
  { value: 'cube', label: 'Cube', hint: 'faces, edges and corners' },
];

const BALL_CLICKS: readonly RadioOption<ViewerState['gizmoBallClick']>[] = [
  { value: 'viewFrom', label: 'View from it', hint: 'like the cube: the back ball shows the back side' },
  { value: 'lookToward', label: 'Look toward it', hint: 'the camera looks the way of the ball' },
];

const SNAP_DOTS: readonly RadioOption<ViewerState['gizmoSnapDots']>[] = [
  { value: 'iso', label: '12 snap dots', hint: '45° side views and iso corners' },
  { value: 'all', label: '20 snap dots', hint: 'also the tilted 45° views, like the cube' },
];

const HEADINGS: readonly RadioOption<ViewerState['topViewHeading']>[] = [
  { value: 'keep', label: 'Keep heading', hint: 'the camera only tilts' },
  { value: 'model', label: 'Model +Y up', hint: 'the back side at the top of the screen' },
  { value: 'north', label: 'True north up', hint: 'turned by the north angle below' },
];

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

/** Settings → Gizmo: which navigation gizmo shows, how it snaps, and true north. */
export function GizmoNavSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <SettingsSection
      id="navGizmo"
      title="Navigation gizmo"
      info={
        <>
          Right-click the gizmo, or press and hold it, to switch between the <b>axis balls</b> and the <b>cube</b>.
          Shift+click gives the opposite view. The ball letters are the first letters of the face names below.{' '}
          <b>True north</b> is measured clockwise from the model's +Y (its back side); the cube can mark it, the balls
          never do.
        </>
      }
    >
      <RadioGroup options={STYLES} value={v.gizmoStyle} onChange={(gizmoStyle) => act.update({ gizmoStyle })} />
      <div className="text-slate-400 text-xs">Clicking a ball</div>
      <RadioGroup
        options={BALL_CLICKS}
        value={v.gizmoBallClick}
        onChange={(gizmoBallClick) => act.update({ gizmoBallClick })}
      />
      <RadioGroup
        options={SNAP_DOTS}
        value={v.gizmoSnapDots}
        onChange={(gizmoSnapDots) => act.update({ gizmoSnapDots })}
      />
      <div className="text-slate-400 text-xs">Top and bottom views</div>
      <RadioGroup
        options={HEADINGS}
        value={v.topViewHeading}
        onChange={(topViewHeading) => act.update({ topViewHeading })}
      />
      <NumberInput
        label="True north"
        labelPosition="split"
        tooltip="Degrees clockwise from the model's +Y (its back side), seen from above. 0 = plant north, as RVM models use"
        value={v.northAngle}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(x) => act.update({ northAngle: x })}
      />
      <Checkbox
        label="North marker on the cube"
        checked={v.gizmoNorthMarker}
        onChange={(x) => act.update({ gizmoNorthMarker: x })}
      />
    </SettingsSection>
  );
}
