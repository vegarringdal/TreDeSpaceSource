import { Checkbox, NumberInput, SegmentedControl, type SegmentedOption } from '@treDeSpaceUI/widgets';
import type { PointColorMode } from '../../../lib/render/pointsLayer';
import { pointStatsState } from '../../../state/scans/pointStats.state';
import { scansActions } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';
import { ScanPointBudget } from './ScanPointBudget';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const COLOR_MODES: readonly SegmentedOption<PointColorMode>[] = [
  { value: 'rgb', label: 'Colour', tooltip: 'The colour the scanner captured', shortcut: 'scans.colorMode' },
  { value: 'intensity', label: 'Intensity', tooltip: 'Grey by laser return intensity', shortcut: 'scans.colorMode' },
];

/** Below this share of the drawn points, the in-view figure is worth showing. */
const CHARGED_SHARE = 0.98;

const fmtMillions = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n.toLocaleString());

/** Point cloud display: on/off, colour, size, and what is streamed. */
export function ScanPointControls() {
  // -----------------------------------------------------------------------------
  // Hooks
  // -----------------------------------------------------------------------------

  const { showPoints, pointSize, colorMode, adaptive, onlySetupPoints } = scansState.use();
  const { drawn, inView, nodes, loading } = pointStatsState.use();

  // -----------------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------------

  // nodes are drawn whole: say so when the budget only counted a share of them
  const isCharged = inView < drawn * CHARGED_SHARE;
  const loadingNote = loading > 0 ? ` · loading ${loading}` : '';
  const readout = isCharged
    ? `about ${fmtMillions(inView)} in view · ${fmtMillions(drawn)} drawn in ${nodes} nodes${loadingNote}`
    : `${fmtMillions(drawn)} points in ${nodes} nodes${loadingNote}`;

  // -----------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-1.5">
      <Checkbox label="Show points" checked={showPoints} onChange={scansActions.togglePoints} shortcut="scans.points" />
      <SegmentedControl value={colorMode} options={COLOR_MODES} onChange={scansActions.setColorMode} grow />
      <NumberInput
        label="Size"
        labelPosition="left"
        labelWidth={56}
        value={pointSize}
        min={1}
        max={10}
        step={1}
        unit="px"
        onChange={scansActions.setPointSize}
        tooltip="Point size on screen (the smallest size when adaptive)"
        decShortcut="scans.pointSize.dec"
        incShortcut="scans.pointSize.inc"
      />
      <ScanPointBudget />
      <Checkbox
        label="Adaptive size (fill gaps up close)"
        checked={adaptive}
        onChange={scansActions.toggleAdaptive}
        shortcut="scans.adaptive"
      />
      <Checkbox
        label="Only the entered setup’s points"
        checked={onlySetupPoints}
        onChange={scansActions.toggleOnlySetupPoints}
        shortcut="scans.onlySetup"
        tooltip="Inside a setup, draw only the points that scanner position measured — what its photo actually saw"
      />
      <span
        className="text-slate-400 text-xs"
        data-tooltip="In view: what the budget counts — an estimate of the points on screen. Drawn: every point of the blocks in use, the parts outside the picture included (a block is drawn whole); never more than twice the budget"
      >
        {showPoints ? readout : 'Points hidden'}
      </span>
    </div>
  );
}
