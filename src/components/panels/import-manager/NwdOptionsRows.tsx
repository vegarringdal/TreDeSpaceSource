import { Checkbox, NumberInput, Select } from '@treDeSpaceUI/widgets';
import { NWD_UNITS } from '../../../lib/nwd2tdp/nwdUnits';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';

const LABEL_WIDTH = 64;

/** The Navisworks section's conversion options: normals, lines, vertex cleanup. */
export function NwdOptionsRows() {
  const { nwd } = assetsState.use();

  return (
    <>
      <Select
        label="Units"
        labelPosition="left"
        labelWidth={LABEL_WIDTH}
        value={nwd.units}
        options={NWD_UNITS}
        onChange={(v) => act.setNwdOptions({ units: v ?? 'auto' })}
        shortcut="assets.nwd.units.next"
        tooltip="What the file’s coordinates are in — the model is converted to metres. Automatic: feet for a file exported from Revit (Revit always stores feet), metres otherwise. Pick another when the model comes in at the wrong size"
      />
      <Checkbox
        label="Normals (smooth shading)"
        shortcut="assets.nwd.normals"
        tooltip="Keep per-vertex normals in the cooked model: curved parts shade smoothly, the file is larger"
        checked={nwd.normals}
        onChange={(v) => act.setNwdOptions({ normals: v })}
      />
      <Checkbox
        label="Include lines"
        shortcut="assets.nwd.lines"
        tooltip="Convert line primitives (construction / datum layer) too, as thin crosses"
        checked={nwd.includeLines}
        onChange={(v) => act.setNwdOptions({ includeLines: v })}
      />
      {nwd.includeLines && (
        <NumberInput
          label="Line width"
          labelPosition="left"
          labelWidth={LABEL_WIDTH}
          tooltip="Width of the line crosses, model units"
          value={nwd.lineWidth}
          min={0.001}
          max={1}
          step={0.001}
          decShortcut="assets.nwd.lineWidth.dec"
          incShortcut="assets.nwd.lineWidth.inc"
          onChange={(v) => act.setNwdOptions({ lineWidth: v })}
        />
      )}
      <Checkbox
        label="Cleanup (weld positions)"
        shortcut="assets.nwd.cleanup"
        tooltip="Weld vertices that share a position within each mesh — smaller files, cleaner edges"
        checked={nwd.cleanup}
        onChange={(v) => act.setNwdOptions({ cleanup: v })}
      />
      {nwd.cleanup && (
        <NumberInput
          label="Precision"
          labelPosition="left"
          labelWidth={LABEL_WIDTH}
          tooltip="Decimal places of the weld grid: 3 welds vertices within 0.001 model units (1 mm in a metre model). Fewer decimals weld more and can remove small parts"
          value={nwd.precision}
          min={0}
          max={6}
          step={1}
          unit="dec"
          decShortcut="assets.nwd.precision.dec"
          incShortcut="assets.nwd.precision.inc"
          onChange={(v) => act.setNwdOptions({ precision: v })}
        />
      )}
      <Checkbox
        label="Full fingerprint"
        shortcut="assets.nwd.fullFingerprint"
        tooltip="Read the whole file when checking whether it was imported before. Off (default): only its size, its start and its end are compared — instant, and enough unless a file was changed in the middle without changing its size"
        checked={nwd.fullFingerprint}
        onChange={(v) => act.setNwdOptions({ fullFingerprint: v })}
      />
    </>
  );
}
