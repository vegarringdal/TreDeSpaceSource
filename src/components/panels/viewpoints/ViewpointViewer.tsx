// Viewpoint Viewer: the simplified presentation panel — the viewpoint names,
// the active one's description right under its row, and quick mute toggles
// for labels/measurements.
import { IconMapPinOff, IconRulerOff, IconUpload } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { cn } from '@treDeSpaceUI/lib/cn';
import { Button, InfoBox, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { richTextHtml } from '../../../lib/richText';
import { labelsActions } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';

/** Minimal viewpoint list for reviewing/presenting — no editing. */
export function ViewpointViewer() {
  useMinSize(200, 160);
  const s = viewpointsState.use();
  const labelsMuted = labelsState.use().muted;
  const measureMuted = measurementsState.use().muted;
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));
  return (
    <PanelBody className="panel-body flex flex-col gap-1.5 overflow-y-auto p-2">
      <div className="flex flex-wrap gap-1.5">
        <Button
          icon={<IconUpload size={14} />}
          tooltip="Load viewpoints from a JSON file (replaces the current set)"
          shortcut="viewpoints.load"
          onClick={picker.open}
        >
          Load
        </Button>
        {picker.element}
        <Button
          active={labelsMuted}
          icon={<IconMapPinOff size={14} />}
          tooltip="Hide/show all labels in the viewport"
          shortcut="labels.muteAll"
          onClick={() => labelsActions.toggleMuted()}
        >
          {labelsMuted ? 'Labels off' : 'Mute labels'}
        </Button>
        <Button
          active={measureMuted}
          icon={<IconRulerOff size={14} />}
          tooltip="Hide/show all measurements in the viewport"
          shortcut="measure.muteAll"
          onClick={() => measurementsActions.toggleMuted()}
        >
          {measureMuted ? 'Measures off' : 'Mute measures'}
        </Button>
      </div>
      {s.list.length === 0 && <InfoBox>No viewpoints — create them in the Viewpoints panel.</InfoBox>}
      {s.list.map((vp) => (
        <div key={vp.id} className="flex flex-col">
          <button
            type="button"
            data-tooltip="Activate this viewpoint"
            className={cn(
              'cursor-pointer border px-2 py-1.5 text-left text-xs transition-colors',
              s.activeId === vp.id
                ? 'border-blue-400 bg-blue-950 text-blue-100'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
            )}
            onClick={() => void act.activate(vp.id)}
          >
            {vp.name}
          </button>
          {s.activeId === vp.id && vp.description.trim().length > 0 && (
            <div
              className="border border-slate-800 border-t-0 bg-slate-950/50 p-2 text-slate-300 text-xs leading-relaxed"
              // richTextHtml HTML-escapes before adding <b>/<br> — no injection
              // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by richTextHtml
              dangerouslySetInnerHTML={{ __html: richTextHtml(vp.description) }}
            />
          )}
        </div>
      ))}
    </PanelBody>
  );
}
