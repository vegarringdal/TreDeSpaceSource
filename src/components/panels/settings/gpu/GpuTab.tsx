import { Button, RadioGroup } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { getRenderer } from '../../../../state/viewer/viewer.actions';
import { SettingsSection } from '../SettingsSection';
import { settingsActions } from '../settings.actions';
import { bootGpu, type SettingsState, settingsState } from '../settings.state';

/**
 * WebGPU can't enumerate GPUs — it can only be ASKED for high-performance /
 * low-power / software-fallback adapters. Probe all three so the radio can
 * show which physical GPU each hint resolves to on this machine.
 */
function useGpuProbe(): Record<string, string> {
  const [gpus, setGpus] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const pref of ['high-performance', 'low-power', 'fallback'] as const) {
        try {
          const a = await navigator.gpu?.requestAdapter({
            powerPreference: pref === 'fallback' ? undefined : pref,
            forceFallbackAdapter: pref === 'fallback',
          });
          const i = a?.info;
          out[pref] = i ? `${i.description || i.device || i.architecture || i.vendor}`.trim() : 'not available';
        } catch {
          out[pref] = 'not available';
        }
      }
      if (alive) {
        setGpus(out);
      }
    })();
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
        options={[
          { value: 'high-performance', label: 'High performance', hint: gpus['high-performance'] ?? '…' },
          { value: 'low-power', label: 'Low power', hint: gpus['low-power'] ?? '…' },
          { value: 'fallback', label: 'Software fallback', hint: gpus.fallback ?? '…' },
        ]}
        value={s.gpu}
        onChange={(x) => settingsActions.setGpu(x as SettingsState['gpu'])}
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
