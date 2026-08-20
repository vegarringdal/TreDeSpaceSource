import { IconList, IconMagnet } from '@tabler/icons-react';
import { Button, NumberInput, RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';
import { ribbonMeasurementsActions as act } from './ribbonMeasurements.actions';

/** Snapping master switch with corner/edge toggles and radii, plus the
 *  measurement list opener. */
export function MeasureSnapGroups() {
  const { snap } = measurementsState.use();

  return (
    <>
      <RibbonSection title="Snapping">
        <RibbonButton
          icon={<IconMagnet />}
          label="Snap"
          selected={snap.enabled}
          shortcut="measure.snap.toggle"
          tooltip="Master switch — off places the raw surface point under the cursor"
          onClick={() => measurementsActions.toggleSnap('enabled')}
        />
        <div className="grid w-fit grid-cols-2 gap-0.5">
          <Button
            className="h-auto min-h-11 justify-center px-1.5 py-1 text-xs"
            active={snap.corner}
            disabled={!snap.enabled}
            tooltip="Snap onto the nearest triangle vertex within the radius"
            shortcut="measure.snap.corner"
            onClick={() => measurementsActions.toggleSnap('corner')}
          >
            Corners
          </Button>
          <Button
            className="h-auto min-h-7 justify-center px-1.5 py-1 text-xs"
            active={snap.edge}
            disabled={!snap.enabled}
            tooltip="Snap onto the nearest triangle edge within the radius"
            shortcut="measure.snap.edge"
            onClick={() => measurementsActions.toggleSnap('edge')}
          >
            Edges
          </Button>
          <div className="w-20">
            <NumberInput
              value={snap.cornerPx}
              min={2}
              max={40}
              step={1}
              unit="px"
              disabled={!snap.enabled || !snap.corner}
              onChange={(v) => measurementsActions.setSnap({ cornerPx: v })}
              decShortcut="measure.snap.cornerPx.dec"
              incShortcut="measure.snap.cornerPx.inc"
            />
          </div>
          <div className="w-20">
            <NumberInput
              value={snap.edgePx}
              min={2}
              max={40}
              step={1}
              unit="px"
              disabled={!snap.enabled || !snap.edge}
              onChange={(v) => measurementsActions.setSnap({ edgePx: v })}
              decShortcut="measure.snap.edgePx.dec"
              incShortcut="measure.snap.edgePx.inc"
            />
          </div>
        </div>
      </RibbonSection>

      <RibbonSection title="List">
        <RibbonButton icon={<IconList />} label="List" shortcut="measure.list" onClick={act.list} />
      </RibbonSection>
    </>
  );
}
