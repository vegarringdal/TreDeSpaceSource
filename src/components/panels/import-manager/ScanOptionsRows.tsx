import { Checkbox, NumberInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { scanWorkerCap } from '../../../state/assets/workerPoolCap';

/** The cook options of a laser-scan import (LGSX / E57 → `.tdpp`). */
export function ScanOptionsRows() {
  const { scan } = assetsState.use();

  return (
    <>
      <Checkbox
        label="Panorama photos"
        shortcut="assets.scan.panoramas"
        tooltip="Keep each scanner setup's cube photos (needed to step into a setup and see the photo)"
        checked={scan.panoramas}
        onChange={(v) => act.setScanOptions({ panoramas: v })}
      />
      <Checkbox
        label="16-bit intensity"
        shortcut="assets.scan.intensity16"
        tooltip="Keep the scanner's full 16-bit intensity. Off (default) stores the 8 bits the viewer shows and makes the file about 15% smaller"
        checked={scan.intensity16}
        onChange={(v) => act.setScanOptions({ intensity16: v })}
      />
      <Checkbox
        label="Full fingerprint"
        shortcut="assets.scan.fullFingerprint"
        tooltip="Read the whole file when checking whether it was imported before. Off (default): only its size, its start and its end are compared — instant, and enough unless a file was changed in the middle without changing its size. A scan of several GB takes about a minute to read"
        checked={scan.fullFingerprint}
        onChange={(v) => act.setScanOptions({ fullFingerprint: v })}
      />
      <NumberInput
        label="Workers"
        labelPosition="left"
        labelWidth={56}
        tooltip="Sub-workers converting the scan (0 = one worker does everything): more = faster, about 0.35 GB of memory each"
        value={scan.workers}
        min={0}
        max={scanWorkerCap()}
        step={1}
        decShortcut="assets.scan.workers.dec"
        incShortcut="assets.scan.workers.inc"
        onChange={(v) => act.setScanOptions({ workers: v })}
      />
    </>
  );
}
