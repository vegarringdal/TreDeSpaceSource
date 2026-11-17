import { videoFrameTimes, videoSegments } from '../../../lib/animation/videoFrames';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { videoExportState } from '../../../state/animation/videoExport.state';

/** How long the video will be, from what is picked — or why it would be
 *  empty. */
export function VideoExportLength() {
  const scenes = animationDocState.useSelect((d) => d.doc.scenes);
  const { settings, pick } = videoExportState.use();
  const segments = videoSegments(scenes, { ...settings, ...pick }, settings.holdS);
  const frames = segments.reduce((n, seg) => n + videoFrameTimes({ ...seg, fps: settings.fps }).length, 0);
  if (segments.length === 0) {
    return (
      <span className="text-amber-400 text-xs">
        Nothing to export — pick an End after the Start, or a scene with keys.
      </span>
    );
  }
  const what = segments.length > 1 ? `${segments.length} scenes, ` : '';
  return (
    <span className="text-slate-400 text-xs">
      The video: {what}
      {(frames / settings.fps).toFixed(1)} s, {frames} frames
    </span>
  );
}
