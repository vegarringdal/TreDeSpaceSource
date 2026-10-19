import { Checkbox, NumberInput, SegmentedControl, Select, type SelectOption } from '@treDeSpaceUI/widgets';
import { videoExportActions } from '../../../state/animation/videoExport.actions';
import type { VideoExportSettings, VideoFps, VideoHeight } from '../../../state/animation/videoExport.state';
import { VideoExportWhatFields } from './VideoExportWhatFields';

const SIZES: readonly SelectOption<'720' | '1080' | '1440'>[] = [
  { value: '720', label: '720p', hint: 'HD' },
  { value: '1080', label: '1080p', hint: 'Full HD' },
  { value: '1440', label: '1440p', hint: 'QHD' },
];
const RATES: readonly SelectOption<'24' | '30' | '60'>[] = [
  { value: '24', label: '24 fps', hint: 'film' },
  { value: '30', label: '30 fps' },
  { value: '60', label: '60 fps', hint: 'smoothest, twice the frames' },
];
const toHeight = (v: string): VideoHeight => (v === '720' ? 720 : v === '1440' ? 1440 : 1080);
const toFps = (v: string): VideoFps => (v === '24' ? 24 : v === '60' ? 60 : 30);
const QUALITIES = [
  {
    value: 'draft',
    label: 'Draft',
    tooltip: 'One render per frame — fast, edges a little rough',
    shortcut: 'animation.video.draft',
  },
  {
    value: 'best',
    label: 'Best',
    tooltip: 'Every frame smoothed like a screenshot — sharp, several times slower',
    shortcut: 'animation.video.best',
  },
] as const;

/** The Export video settings. */
export function VideoExportFields({ s, disabled }: { s: VideoExportSettings; disabled: boolean }) {
  const set = videoExportActions.set;
  return (
    <div className="flex flex-col gap-1.5">
      <Select
        label="Size"
        labelPosition="split"
        fieldWidth={180}
        value={String(s.height)}
        options={SIZES}
        clearable={false}
        disabled={disabled}
        tooltip="Video height; the width follows the 3D view's shape"
        shortcut="animation.video.size"
        onChange={(v) => v && set({ height: toHeight(v) })}
      />
      <Select
        label="Frame rate"
        labelPosition="split"
        fieldWidth={180}
        value={String(s.fps)}
        options={RATES}
        clearable={false}
        disabled={disabled}
        tooltip="Frames per second of video"
        shortcut="animation.video.fps"
        onChange={(v) => v && set({ fps: toFps(v) })}
      />
      <VideoExportWhatFields s={s} disabled={disabled} />
      <div className="flex items-center gap-2 text-xs">
        <span className="flex-1 text-slate-400">Quality</span>
        <SegmentedControl
          size="sm"
          value={s.quality}
          options={QUALITIES}
          onChange={(quality) => !disabled && set({ quality })}
        />
      </div>
      <NumberInput
        label="Wait at pausing steps"
        labelPosition="split"
        value={s.holdS}
        min={0}
        max={10}
        step={0.5}
        unit="s"
        disabled={disabled}
        tooltip="Steps set to pause at their end stand still this long in the video"
        decShortcut="animation.video.hold.dec"
        incShortcut="animation.video.hold.inc"
        onChange={(holdS) => set({ holdS })}
      />
      <Checkbox
        label="Overlays (step cards, callouts)"
        checked={s.overlays}
        disabled={disabled}
        tooltip="Draw the 2D overlays and scene labels into the video"
        shortcut="animation.video.overlays"
        onChange={(overlays) => set({ overlays })}
      />
    </div>
  );
}
