import {
  Checkbox,
  NumberInput,
  RadioGroup,
  type RadioOption,
  SegmentedControl,
  type SegmentedOption,
} from '@treDeSpaceUI/widgets';
import type { PointColorMode } from '../../../lib/render/pointsLayer';
import { pointStatsState } from '../../../state/scans/pointStats.state';
import { arePointsShown, type PointsMode } from '../../../state/scans/pointsMode';
import { scansActions } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';
import { ScanPointBudget } from './ScanPointBudget';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const POINTS_MODES: readonly RadioOption<PointsMode>[] = [
  {
    value: 'off',
    label: 'Off (unload)',
    info: 'The points are not loaded: the scan is its scan spheres and photos only, and uses no memory for points. Switching back on loads them again.',
    shortcut: 'scans.points.off',
  },
  {
    value: 'hidden',
    label: 'Hidden (keep loaded)',
    info: 'The points are not drawn, but what is loaded stays in memory, so they are back at once.',
    shortcut: 'scans.points.hidden',
  },
  {
    value: 'always',
    label: 'Always',
    info: 'The points are drawn in the free view and inside a scan sphere.',
    shortcut: 'scans.points.always',
  },
  {
    value: 'entered',
    label: 'Only inside a scan sphere',
    info: 'The points are drawn only while a scan sphere is entered. Nothing is loaded while you move around freely, so this uses the least memory.',
    shortcut: 'scans.points.entered',
  },
];

const COLOR_MODES: readonly SegmentedOption<PointColorMode>[] = [
  { value: 'rgb', label: 'Colour', tooltip: 'The colour the scanner captured', shortcut: 'scans.colorMode' },
  { value: 'intensity', label: 'Intensity', tooltip: 'Grey by laser return intensity', shortcut: 'scans.colorMode' },
];

/** The readout while no points are drawn, by mode. */
const HIDDEN_NOTES: Readonly<Record<PointsMode, string>> = {
  off: 'Points off — not loaded',
  hidden: 'Points hidden — kept loaded',
  always: 'No points to show',
  entered: 'Points show inside a scan sphere',
};

/** Below this share of the drawn points, the in-view figure is worth showing. */
const CHARGED_SHARE = 0.98;

const fmtMillions = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n.toLocaleString());

/** Point cloud display: on/off, colour, size, and what is streamed. */
export function ScanPointControls() {
  // -----------------------------------------------------------------------------
  // Hooks
  // -----------------------------------------------------------------------------

  const { pointsMode, active, pointSize, colorMode, adaptive, pointAdaptiveMax, onlySetupPoints } = scansState.use();
  const { drawn, inView, nodes, loading } = pointStatsState.use();

  // -----------------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------------

  // a node is cut in ranges, not point by point: more is drawn than is in view
  const isCharged = inView < drawn * CHARGED_SHARE;
  const loadingNote = loading > 0 ? ` · loading ${loading}` : '';
  const readout = isCharged
    ? `about ${fmtMillions(inView)} in view · ${fmtMillions(drawn)} drawn in ${nodes} nodes${loadingNote}`
    : `${fmtMillions(drawn)} points in ${nodes} nodes${loadingNote}`;
  const hiddenNote = HIDDEN_NOTES[pointsMode];

  // -----------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-slate-300 text-xs"
        data-shortcut="scans.points"
        data-tooltip="When the points are loaded and drawn. The shortcut hides them and brings them back"
      >
        Show points
      </span>
      <RadioGroup value={pointsMode} options={POINTS_MODES} onChange={scansActions.setPointsMode} className="pl-2" />
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
      <NumberInput
        label="Max size"
        labelPosition="left"
        labelWidth={56}
        value={pointAdaptiveMax}
        min={2}
        max={24}
        step={1}
        unit="px"
        disabled={!adaptive}
        onChange={scansActions.setPointAdaptiveMax}
        tooltip="The largest size an adaptive point grows to. Small keeps stray points (scan noise) from turning into big squares; large fills wider gaps up close"
        decShortcut="scans.adaptiveMax.dec"
        incShortcut="scans.adaptiveMax.inc"
      />
      <Checkbox
        label="Only the entered scan sphere’s points"
        checked={onlySetupPoints}
        onChange={scansActions.toggleOnlySetupPoints}
        shortcut="scans.onlySetup"
        tooltip="Inside a scan sphere, draw only the points that scanner position measured — what its photo actually saw"
      />
      <span
        className="text-slate-400 text-xs"
        data-tooltip="In view: what the budget counts — an estimate of the points on screen. Drawn: the points sent to the graphics card — the blocks in use, without the parts of them that lie outside the picture. The blocks are still held whole in memory, never more than twice the budget"
      >
        {arePointsShown(pointsMode, active) ? readout : hiddenNote}
      </span>
    </div>
  );
}
