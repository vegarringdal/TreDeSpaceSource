import { IconEraser, IconEyeOff, IconTrashX } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { ribbonHomeActions as act } from './ribbonHome.actions';

/** Mute and Clear — a label column and a measurement column, mute over
 *  clear — then Wipe: the nuke-everything local reset. */
export function HomeResetGroups() {
  return (
    <>
      <RibbonSection title="Mute and Clear">
        <RibbonButton
          size="medium"
          icon={<IconEyeOff />}
          label="Mute Label"
          tooltip="Mute every label in the viewport (scene AND viewpoint) — press again to unmute; nothing is deleted"
          shortcut="home.label.mute"
          onClick={act.muteLabels}
        />
        <RibbonButton
          size="medium"
          icon={<IconEraser />}
          label="Clear Label"
          tooltip="Delete the scene's labels — a live viewpoint's labels are muted instead, never deleted"
          shortcut="home.label.clear"
          onClick={() => void act.deleteLabels()}
        />
        <RibbonButton
          size="medium"
          icon={<IconEyeOff />}
          label="Mute Measurement"
          tooltip="Mute every measurement in the viewport (scene AND viewpoint) — press again to unmute; nothing is deleted"
          shortcut="home.measurement.mute"
          onClick={act.muteMeasurements}
        />
        <RibbonButton
          size="medium"
          icon={<IconEraser />}
          label="Clear Measurement"
          tooltip="Delete the scene's measurements — a live viewpoint's measurements are muted instead, never deleted"
          shortcut="home.measurement.clear"
          onClick={() => void act.deleteMeasurements()}
        />
      </RibbonSection>
      <RibbonSection title="Wipe">
        <RibbonButton
          icon={<IconTrashX />}
          label="Wipe all"
          tooltip="Wipe ALL locally saved data — settings, layout, hotkeys, viewpoints, rules AND every imported asset — then reload"
          shortcut="home.wipe.all"
          onClick={() => void act.wipeAllLocal()}
        />
      </RibbonSection>
    </>
  );
}
