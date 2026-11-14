import { IconArrowLeft, IconArrowRight, IconDoorEnter, IconDoorExit } from '@tabler/icons-react';
import { Button, Checkbox, NumberInput, SegmentedControl, type SegmentedOption } from '@treDeSpaceUI/widgets';
import type { PanoMode } from '../../../lib/render/panoPass';
import { scansActions } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';

const MODES: readonly SegmentedOption<PanoMode>[] = [
  {
    value: 'over',
    label: 'Over all',
    tooltip: 'Photo covers the model and the points — lower the opacity to see through it',
    shortcut: 'scans.mode',
  },
  {
    value: 'background',
    label: 'Background',
    tooltip: 'Photo only where nothing is drawn (hide the points to see it behind the model)',
    shortcut: 'scans.mode',
  },
];

/** Enter / exit / step through setups, and the panorama look. */
export function ScanControls() {
  const { selected, active, opacity, mode, showMarkers, markerOpacity, busy } = scansState.use();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<IconDoorEnter size={14} />}
          disabled={!selected || busy}
          onClick={() => void scansActions.enter()}
          shortcut="scans.enter"
        >
          Enter
        </Button>
        <Button icon={<IconDoorExit size={14} />} disabled={!active} onClick={scansActions.exit} shortcut="scans.exit">
          Exit
        </Button>
        <Button icon={<IconArrowLeft size={14} />} onClick={() => void scansActions.step(-1)} shortcut="scans.prev" />
        <Button icon={<IconArrowRight size={14} />} onClick={() => void scansActions.step(1)} shortcut="scans.next" />
      </div>
      <SegmentedControl value={mode} options={MODES} onChange={scansActions.setMode} grow />
      <NumberInput
        label="Opacity"
        labelPosition="left"
        labelWidth={56}
        value={opacity}
        min={0}
        max={100}
        step={10}
        unit="%"
        onChange={scansActions.setOpacity}
        tooltip="Photo opacity: 100 % shows the photo alone, lower blends it with the model and the points"
        decShortcut="scans.opacity.dec"
        incShortcut="scans.opacity.inc"
      />
      <Checkbox
        label="Show setup markers"
        checked={showMarkers}
        onChange={scansActions.toggleMarkers}
        shortcut="scans.markers"
      />
      <NumberInput
        label="Markers"
        labelPosition="left"
        labelWidth={56}
        value={markerOpacity}
        min={10}
        max={100}
        step={10}
        unit="%"
        disabled={!showMarkers}
        onChange={scansActions.setMarkerOpacity}
        tooltip="Opacity of the setup marker spheres: lower it when they are in the way (they can still be double-clicked)"
        decShortcut="scans.markerOpacity.dec"
        incShortcut="scans.markerOpacity.inc"
      />
    </div>
  );
}
