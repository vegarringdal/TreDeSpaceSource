import { Button, Collapsible, RadioGroup } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
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

/** Settings → GPU tab: adapter preference + reload-to-apply. */
export function GpuTab() {
  const s = settingsState.use();
  const gpus = useGpuProbe();

  return (
    <Collapsible title="GPU">
      <div className="text-slate-400 text-xs">
        Browsers only take a hint (WebGPU cannot list GPUs directly) — each choice shows the adapter it resolves to on
        this machine. Takes effect after a reload.
      </div>
      <RadioGroup
        options={[
          { value: 'high-performance', label: 'High performance', hint: gpus['high-performance'] ?? '…' },
          { value: 'low-power', label: 'Low power', hint: gpus['low-power'] ?? '…' },
          { value: 'fallback', label: 'Software fallback', hint: gpus.fallback ?? '…' },
        ]}
        value={s.gpu}
        onChange={(x) => settingsActions.setGpu(x as SettingsState['gpu'])}
      />
      <Button
        className="mt-1 self-start"
        disabled={s.gpu === bootGpu}
        onClick={() => window.location.reload()}
        tooltip="Reload the app so the selected GPU takes effect"
        shortcut="settings.gpuReload"
      >
        Reload to apply
      </Button>
    </Collapsible>
  );
}
