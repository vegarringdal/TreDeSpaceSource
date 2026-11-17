// Export video (DESIGN.md › Animation › Capture): settings, then progress with
// Cancel while the frames are rendered and encoded.
import { IconMovie } from '@tabler/icons-react';
import { Button, DialogFrame, InfoBox, ProgressBar } from '@treDeSpaceUI/widgets';
import { videoExportActions } from '../../../state/animation/videoExport.actions';
import { type VideoExportPhase, videoExportState } from '../../../state/animation/videoExport.state';
import { VideoExportFields } from './VideoExportFields';
import { VideoExportLength } from './VideoExportLength';

/** "Frame 120 of 900 · about 2:10 left" while rendering. */
function progressText(p: VideoExportPhase): string {
  if (p.kind === 'finishing') {
    return 'Packing the video file…';
  }
  if (p.kind !== 'rendering') {
    return '';
  }
  const done = p.frame;
  const elapsed = (performance.now() - p.startedAt) / 1000;
  const left = done > 0 ? Math.round((elapsed / done) * (p.total - done)) : null;
  const eta = left === null ? '' : ` · about ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
  return `Frame ${done + 1} of ${p.total}${eta}`;
}

/** The Export video window (mounted once in the dialog host). */
export function VideoExportDialog() {
  const { open, settings, phase } = videoExportState.use();
  if (!open) {
    return null;
  }
  const busy = phase.kind !== 'idle';
  const value =
    phase.kind === 'rendering' ? phase.frame / Math.max(1, phase.total) : phase.kind === 'finishing' ? null : 0;

  const footer = busy ? (
    <Button
      tooltip="Stop after this frame — nothing is saved"
      shortcut="animation.video.cancel"
      onClick={videoExportActions.cancel}
    >
      Cancel
    </Button>
  ) : (
    <div className="flex gap-1.5">
      <Button tooltip="Close without exporting" shortcut="animation.video.close" onClick={videoExportActions.close}>
        Close
      </Button>
      <Button
        variant="primary"
        tooltip="Render the frames and download the .mp4"
        shortcut="animation.video.start"
        onClick={() => void videoExportActions.start()}
      >
        Export
      </Button>
    </div>
  );

  return (
    <DialogFrame
      icon={<IconMovie size={16} className="text-sky-400" />}
      title="Export video"
      width="min(440px, 94vw)"
      onClose={videoExportActions.close}
      footer={footer}
    >
      <div className="flex flex-col gap-3">
        <VideoExportFields s={settings} disabled={busy} />
        {!busy && <VideoExportLength />}
        {busy ? (
          <div className="flex flex-col gap-1 text-slate-300 text-xs">
            <ProgressBar value={value} />
            {progressText(phase)}
            <span className="text-slate-500">Keep this tab in front — the export waits while it is hidden.</span>
          </div>
        ) : (
          <InfoBox tone="info">
            The video is made frame by frame, so it plays smoothly whatever this computer manages. Keep this tab in
            front until it is done: in a hidden or minimised tab the browser stops drawing, so the export waits (the
            tab's title says so) and carries on when you come back. The selection is cleared for the video; the open
            scene, the time slider, your view and the selection come back after.
          </InfoBox>
        )}
      </div>
    </DialogFrame>
  );
}
