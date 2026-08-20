import { RibbonButton, RibbonNumber, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonClippingBoxActions as act } from './ribbonClippingBox.actions';
import { ribbonClippingBoxState } from './ribbonClippingBox.state';

/** Fit-to-selection/scene sizing for the clipping box, with the offset margin. */
export function ClipBoxSizeGroup() {
  const s = ribbonClippingBoxState.use();
  const noSel = selectionState.use().count === 0;

  return (
    <RibbonSection title="Box size">
      <RibbonButton
        size="mini"
        label="Fit Sel"
        disabled={noSel}
        shortcut="clip.box.fitSel"
        onClick={() => void act.fitSel()}
      />
      <RibbonButton
        size="mini"
        label="Fit Sel +Off."
        disabled={noSel}
        tooltip="Fit the box to the selection with the offset margin (right) added on every side"
        shortcut="clip.box.fitSelOffset"
        onClick={() => act.fitSelOffset()}
      />
      <RibbonButton
        size="mini"
        label="Focus On Set"
        selected={s.focusOnSet}
        tooltip="When on, Fit Sel / Fit Sel +Off. also move the orbit point to the clipping box center"
        shortcut="clip.box.focusOnSet"
        onClick={act.toggleFocusOnSet}
      />
      <RibbonButton size="medium" label="Fit Scene" shortcut="clip.box.fitScene" onClick={act.fitScene} />
      <RibbonNumber
        size="medium"
        unit="m"
        min={0}
        step={0.1}
        precision={1}
        value={s.fitOffset}
        decShortcut="clip.box.fitOffset.dec"
        incShortcut="clip.box.fitOffset.inc"
        onChange={act.setFitOffset}
      />
    </RibbonSection>
  );
}
