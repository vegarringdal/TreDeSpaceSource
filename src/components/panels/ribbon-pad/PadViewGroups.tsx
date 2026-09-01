import {
  IconArrowBigDown,
  IconArrowBigUp,
  IconArrowsMaximize,
  IconFocus2,
  IconFocusCentered,
  IconLayoutDistributeVertical,
  IconPlaneTilt,
} from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { useSyncExternalStore } from 'react';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { toggleSoloPanels } from '../ribbon-home/soloPanels';

/** View helpers (fly/focus/solo) and tree navigation with pad-sized targets. */
export function PadViewGroups() {
  const { manager } = usePanelContext();
  // re-render on layout changes so the Solo button tracks manager.isSolo()
  useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.version,
  );

  return (
    <>
      <RibbonSection title="View">
        <RibbonButton
          icon={<IconPlaneTilt />}
          label="Fly to"
          tooltip="Fly to the selection (fit its bounding box)"
          shortcut="camera.flyTo"
          onClick={() => void viewerActions.flyToSelection()}
        />
        <RibbonButton
          icon={<IconFocus2 />}
          label="Focus click"
          tooltip="Re-pivot on the last clicked point (same as Alt+click) — camera stays put"
          shortcut="camera.focusClick"
          onClick={() => viewerActions.focusLastClick()}
        />
        <RibbonButton
          icon={<IconFocusCentered />}
          label="Focus sel."
          tooltip="Re-pivot on the selection center — camera stays put"
          shortcut="camera.focusSelection"
          onClick={() => void viewerActions.focusSelection()}
        />
        <RibbonButton
          icon={<IconArrowsMaximize />}
          label="Fit visible"
          tooltip="Frame everything that is not hidden — hide or isolate first to zoom onto a set"
          shortcut="camera.fitVisible"
          onClick={() => void viewerActions.fitVisible()}
        />
        <RibbonButton
          icon={<IconLayoutDistributeVertical />}
          label="Solo"
          selected={manager.isSolo()}
          tooltip="Close every panel except the main one — click again to restore the layout"
          shortcut="view.soloPanels"
          onClick={() => toggleSoloPanels()}
        />
      </RibbonSection>

      <RibbonSection title="Tree">
        <RibbonButton
          icon={<IconArrowBigUp />}
          label="Up"
          tooltip="Select the parent of the active item (same as U)"
          shortcut="hierarchy.navUp"
          onClick={() => void viewerActions.navUp()}
        />
        <RibbonButton
          icon={<IconArrowBigDown />}
          label="Down"
          tooltip="Select back down into the previous child (same as P)"
          shortcut="hierarchy.navDown"
          onClick={() => void viewerActions.navDown()}
        />
      </RibbonSection>
    </>
  );
}
