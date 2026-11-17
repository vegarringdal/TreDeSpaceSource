import { Button, RadioGroup, type RadioOption } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { adapterLabel, probeAdapters } from '../../../../lib/render/gpuProbe';
import { getRenderer } from '../../../../state/viewer/viewer.actions';
import { SettingsSection } from '../SettingsSection';
import { settingsActions } from '../settings.actions';
import { bootGpu, type SettingsState, settingsState } from '../settings.state';

const GPU_HINTS: readonly RadioOption<SettingsState['gpu']>[] = [
  { value: 'high-performance', label: 'High performance' },
  { value: 'low-power', label: 'Low power' },
  { value: 'fallback', label: 'Software fallback' },
];

/** Which physical GPU each adapter hint resolves to on this machine, as
 *  radio hints (WebGPU can't list GPUs — see gpuProbe.ts). */
function useGpuProbe(): Record<string, string> {
  const [gpus, setGpus] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void probeAdapters().then((facts) => {
      const out: Record<string, string> = {};
      for (const [hint, f] of Object.entries(facts)) {
        out[hint] = adapterLabel(f);
      }
      if (alive) {
        setGpus(out);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return gpus;
}

/** Settings → GPU tab: adapter preference + reload-to-apply, and the
 *  device-loss test button that exercises the crash-recovery prompt. */
export function GpuTab() {
  const s = settingsState.use();
  const gpus = useGpuProbe();

  return (
    <SettingsSection
      id="gpu"
      title="GPU"
      info={
        <>
          Which graphics adapter the viewer asks the browser for. Browsers only take a hint — WebGPU cannot list GPUs
          directly — so each choice shows the adapter it resolves to on this machine. A new choice takes effect after a
          reload, because the GPU device is baked into the render pipelines. "Simulate GPU crash" destroys the live
          device to exercise the crash-recovery prompt.
        </>
      }
    >
      <RadioGroup
        options={GPU_HINTS.map((o) => ({ ...o, hint: gpus[o.value] ?? '…' }))}
        value={s.gpu}
        onChange={settingsActions.setGpu}
      />
      <div className="mt-1 flex gap-2">
        <Button
          disabled={s.gpu === bootGpu}
          onClick={() => window.location.reload()}
          tooltip="Reload the app so the selected GPU takes effect"
          shortcut="settings.gpuReload"
        >
          Reload to apply
        </Button>
        <Button
          onClick={() => getRenderer()?.simulateDeviceLoss()}
          tooltip="Destroy the WebGPU device to test the crash-recovery prompt (a real GPU-process crash: chrome://gpucrash)"
          shortcut="settings.gpuCrashTest"
        >
          Simulate GPU crash
        </Button>
      </div>
    </SettingsSection>
  );
}
