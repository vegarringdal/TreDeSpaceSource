import { Button, RadioGroup } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { SettingsSection } from '../SettingsSection';
import { logMeshletFill } from './fillStats';

const debugBuffers = [
  { value: '0', label: 'Off', shortcut: 'render.debug.off' },
  { value: '1', label: 'Normal', shortcut: 'render.debug.normal' },
  { value: '2', label: 'Depth', shortcut: 'render.debug.depth' },
  { value: '3', label: 'Item ID', shortcut: 'render.debug.id' },
  { value: '4', label: 'Edge', shortcut: 'render.debug.edge' },
  { value: '5', label: 'AO', shortcut: 'render.debug.ao' },
];

/** Rendering → Debug: meshlet colors, debug buffer view and fill stats. */
export function DebugSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <SettingsSection
      id="debug"
      title="Debug"
      info={
        <>
          Renderer diagnostics: colour every meshlet differently, or show one of the internal buffers (normals, depth,
          item ids, edges, AO) instead of the shaded picture.
        </>
      }
    >
      <Check
        label="Meshlet colors"
        checked={v.meshletVis}
        shortcut="render.meshlet"
        onChange={(x) => act.update({ meshletVis: x })}
      />
      <div className="mt-1 text-slate-400 text-xs">Debug buffer</div>
      <RadioGroup
        options={debugBuffers}
        value={String(v.debugBuf)}
        onChange={(x) => act.update({ debugBuf: Number(x) as 0 | 1 | 2 | 3 | 4 | 5 })}
      />
      <Button
        className="mt-2 self-start"
        onClick={() => void logMeshletFill()}
        tooltip="Read meshlet fill statistics for every loaded model back from the GPU and print the report to the Console panel — shows the VRAM lost to part-empty meshlets"
        shortcut="render.meshletFill"
      >
        Log meshlet fill
      </Button>
    </SettingsSection>
  );
}
