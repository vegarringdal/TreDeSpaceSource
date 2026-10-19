import { IconFlag, IconRuler2 } from '@tabler/icons-react';
import { Button, SegmentedControl, Select, TimeInput } from '@treDeSpaceUI/widgets';
import { sceneView } from '../../../lib/animation/scene';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { videoExportActions } from '../../../state/animation/videoExport.actions';
import { type VideoExportSettings, videoExportState } from '../../../state/animation/videoExport.state';

const SCENES = [
  {
    value: 'all',
    label: 'All scenes',
    tooltip: 'Every scene, one after another, each from its start to its end',
    shortcut: 'animation.video.allScenes',
  },
  {
    value: 'one',
    label: 'One scene',
    tooltip: 'One scene — all of it, or a part',
    shortcut: 'animation.video.oneScene',
  },
] as const;

const SPANS = [
  { value: 'whole', label: 'Whole scene', tooltip: 'From its start to its end', shortcut: 'animation.video.whole' },
  { value: 'part', label: 'Part', tooltip: 'From Start to End (seconds)', shortcut: 'animation.video.part' },
] as const;

/** Which scenes go into the video and, for one scene, all of it or a part
 *  from Start to End — filled from the in / out range or the step at the
 *  time slider. */
export function VideoExportWhatFields({ s, disabled }: { s: VideoExportSettings; disabled: boolean }) {
  const scenes = animationDocState.useSelect((d) => d.doc.scenes);
  const pick = videoExportState.useSelect((v) => v.pick);
  const many = scenes.length > 1;
  const one = !many || s.scenes === 'one';
  const scene = scenes.find((x) => x.id === pick.scene);
  const duration = scene ? sceneView(scene).duration : 0;
  const set = videoExportActions.set;

  return (
    <div className="flex flex-col gap-1.5">
      {many && (
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-slate-400">Scenes</span>
          <SegmentedControl
            size="sm"
            value={s.scenes}
            options={SCENES}
            disabled={disabled}
            onChange={(v) => set({ scenes: v })}
          />
        </div>
      )}
      {many && one && (
        <Select
          label="Scene"
          labelPosition="split"
          fieldWidth={180}
          value={pick.scene}
          options={scenes.map((x) => ({ value: x.id, label: x.name || 'Scene' }))}
          clearable={false}
          disabled={disabled}
          tooltip="The scene the video shows"
          shortcut="animation.video.scene.next"
          onChange={(v) => v && videoExportActions.setPick({ scene: v })}
        />
      )}
      {one && (
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 text-slate-400">What</span>
          <SegmentedControl
            size="sm"
            value={s.span}
            options={SPANS}
            disabled={disabled}
            onChange={(v) => set({ span: v })}
          />
        </div>
      )}
      {one && s.span === 'part' && (
        <>
          <div className="flex items-center gap-1.5">
            <TimeInput
              className="min-w-0 flex-1"
              label="Start"
              labelPosition="left"
              labelWidth={40}
              min={0}
              value={pick.from}
              disabled={disabled}
              tooltip="Where the video starts (s on the scene's clock)"
              onChange={(from) => videoExportActions.setPick({ from })}
            />
            <TimeInput
              className="min-w-0 flex-1"
              label="End"
              labelPosition="left"
              labelWidth={40}
              min={0}
              value={pick.to}
              disabled={disabled}
              tooltip={`Where it ends (s) — the scene lasts ${duration.toFixed(1)} s; later holds its last picture`}
              onChange={(to) => videoExportActions.setPick({ to })}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              icon={<IconRuler2 />}
              disabled={disabled}
              tooltip="Start and End from the Timeline's in / out range (Shift + drag on the ruler) — the open scene"
              shortcut="animation.video.part.fromRange"
              onClick={videoExportActions.partFromRange}
            >
              In / out range
            </Button>
            <Button
              size="sm"
              icon={<IconFlag />}
              disabled={disabled}
              tooltip="Start and End of the step at the time slider — the open scene"
              shortcut="animation.video.part.fromStep"
              onClick={videoExportActions.partFromStep}
            >
              Step at the time slider
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
