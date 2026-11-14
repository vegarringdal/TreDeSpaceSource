import { Checkbox, NumberInput } from '@treDeSpaceUI/widgets';
import { scansActions } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';

const LABEL_WIDTH = 56;

/** How the point budget is spent: how many points, how far, where the detail
 *  goes and how much is kept in memory. */
export function ScanPointBudget() {
  const { pointBudget, pointDetail, pointMaxDistance, pointFocusDistance, pointInViewBudget, pointCache } =
    scansState.use();

  return (
    <>
      <NumberInput
        label="Budget"
        labelPosition="left"
        labelWidth={LABEL_WIDTH}
        value={pointBudget}
        min={1}
        max={50}
        step={1}
        unit="M"
        onChange={scansActions.setPointBudget}
        tooltip="Most points drawn at once over all scans, millions (GPU memory ≈ 16 B per point, plus the cache)"
        decShortcut="scans.budget.dec"
        incShortcut="scans.budget.inc"
      />
      <NumberInput
        label="Detail"
        labelPosition="left"
        labelWidth={LABEL_WIDTH}
        value={pointDetail}
        min={0.5}
        max={8}
        step={0.5}
        precision={1}
        unit="×"
        onChange={scansActions.setPointDetail}
        tooltip="How fine the points are loaded. 1 ×: until they sit about one point size apart on screen. Higher loads closer points without moving nearer — 2 × is twice as close, about four times the points — until the budget is full. Raise it when gaps show and the budget is not used up; lower it to load less"
        decShortcut="scans.detail.dec"
        incShortcut="scans.detail.inc"
      />
      <NumberInput
        label="Max dist"
        labelPosition="left"
        labelWidth={LABEL_WIDTH}
        value={pointMaxDistance}
        min={0}
        max={2000}
        step={10}
        unit="m"
        onChange={scansActions.setPointMaxDistance}
        tooltip="Points farther from the camera than this are not streamed or drawn (0 = no limit). The whole budget is then spent within this distance, so what is near gets finer"
        decShortcut="scans.maxDistance.dec"
        incShortcut="scans.maxDistance.inc"
      />
      <NumberInput
        label="Focus"
        labelPosition="left"
        labelWidth={LABEL_WIDTH}
        value={pointFocusDistance}
        min={0}
        max={500}
        step={5}
        unit="m"
        onChange={scansActions.setPointFocusDistance}
        tooltip="Full detail within this distance of the camera; beyond it the detail falls off, so a tight budget goes to what is near first (0 = even detail on screen)"
        decShortcut="scans.focusDistance.dec"
        incShortcut="scans.focusDistance.inc"
      />
      <NumberInput
        label="Cache"
        labelPosition="left"
        labelWidth={LABEL_WIDTH}
        value={pointCache}
        min={0}
        max={200}
        step={25}
        unit="%"
        onChange={scansActions.setPointCache}
        tooltip="Points kept in memory beyond the budget, so turning or moving back needs no reload. 0 = keep only what is shown (least memory)"
        decShortcut="scans.cache.dec"
        incShortcut="scans.cache.inc"
      />
      <Checkbox
        label="Budget counts points in view only"
        checked={pointInViewBudget}
        onChange={scansActions.togglePointInViewBudget}
        shortcut="scans.inViewBudget"
        tooltip="Large blocks of points that reach outside the view are charged only for the part in view: finer detail on screen, somewhat more memory. Off = every loaded point counts"
      />
    </>
  );
}
