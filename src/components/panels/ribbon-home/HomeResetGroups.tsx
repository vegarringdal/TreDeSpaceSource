import { IconEraser } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { ribbonHomeActions as act } from './ribbonHome.actions';

/** Quick Clear — delete the scene's labels / measurements. */
export function HomeResetGroups() {
  return (
    <RibbonSection title="Quick Clear">
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
        icon={<IconEraser />}
        label="Clear Measurement"
        tooltip="Delete the scene's measurements — a live viewpoint's measurements are muted instead, never deleted"
        shortcut="home.measurement.clear"
        onClick={() => void act.deleteMeasurements()}
      />
    </RibbonSection>
  );
}
