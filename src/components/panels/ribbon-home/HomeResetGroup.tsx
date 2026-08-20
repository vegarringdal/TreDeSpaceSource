import { IconCameraX, IconEraser, IconEyeOff, IconPaletteOff, IconTrashX } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { ribbonHomeActions as act } from './ribbonHome.actions';

/** Reset actions: mute/clear labels and measurements, viewpoints, Set Color
 *  rules, and the nuke-everything local reset. */
export function HomeResetGroup() {
  return (
    <RibbonSection title="Reset">
      <RibbonButton
        size="medium"
        icon={<IconEyeOff />}
        label="Mute Labels/Measurements"
        tooltip="Mute every label and measurement in the viewport (scene AND viewpoint) — press again to unmute; nothing is deleted"
        shortcut="home.reset.muteLm"
        onClick={act.muteLabelsMeasurements}
      />
      <RibbonButton
        size="medium"
        icon={<IconEraser />}
        label="Clear Labels/Measurements"
        tooltip="Delete the scene's labels and measurements — a live viewpoint's content is muted instead, never deleted"
        shortcut="home.reset.deleteLm"
        onClick={() => void act.deleteLabelsMeasurements()}
      />
      <RibbonButton
        size="medium"
        icon={<IconCameraX />}
        label="Clear Viewpoints"
        tooltip="Delete every viewpoint (the scene's own labels/measurements are restored first)"
        shortcut="home.reset.viewpoints"
        onClick={() => void act.clearViewpoints()}
      />
      <RibbonButton
        size="medium"
        icon={<IconPaletteOff />}
        label="Clear Set Color"
        tooltip="Reset the Set Color editor to its empty default rule set"
        shortcut="home.reset.setColor"
        onClick={act.clearSetColor}
      />
      <RibbonButton
        icon={<IconTrashX />}
        label="Clear all"
        tooltip="Delete ALL locally saved data — settings, layout, hotkeys, viewpoints, rules AND every imported asset — then reload"
        shortcut="home.reset.all"
        onClick={() => void act.clearAllLocal()}
      />
    </RibbonSection>
  );
}
