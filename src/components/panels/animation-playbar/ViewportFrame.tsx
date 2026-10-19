import { cn } from '@treDeSpaceUI/lib/cn';
import { formatTime } from '../../../lib/animation/timeFormat';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { activeScene } from '../../../state/animation/docEdit';
import { playerState } from '../../../state/animation/player.state';

/** Authoring hints over the 3D view: a red frame while Auto-key keys every
 *  drag, and a banner while a pose (or the next colour rules) waits for Key. */
export function ViewportFrame() {
  const ui = animationUiState.use();
  const time = playerState.useSelect((s) => s.time);
  const doc = animationDocState.use().doc;
  const annotations = ui.previewLabels ? 'labels' : ui.previewMeasurements ? 'measurements' : null;
  if (ui.mode.kind !== 'author' || (!ui.autoKey && !ui.posing && !ui.previewRules && !annotations)) {
    return null;
  }
  const names = (ui.posing?.objects ?? []).map((id) => activeScene(doc)?.objects.find((o) => o.id === id)?.name ?? '');
  const what = ui.posing
    ? names.length > 1
      ? `${names.length} objects`
      : names[0] || 'object'
    : ui.previewRules
      ? 'colour rules'
      : (annotations ?? '');
  const waiting = ui.posing !== null || ui.previewRules || annotations !== null;
  const change = ui.posing ? 'moved' : ui.previewRules ? 'shown' : 'changed';

  return (
    <div className={cn('pointer-events-none absolute inset-0', ui.autoKey && 'border-[3px] border-red-500/90')}>
      <div className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 bg-slate-950/90 px-3 py-1 text-slate-100 text-xs shadow-black/50 shadow-lg">
        {ui.autoKey && <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />}
        {waiting ? (
          <span>
            <span className="text-amber-300">
              {what} {change} — not keyed
            </span>{' '}
            · {formatTime(time)} · press <b>Key (I)</b>; moving the time slider drops it
          </span>
        ) : (
          <span className="text-red-200">Auto-key — every drag keys at {formatTime(time)}</span>
        )}
      </div>
    </div>
  );
}
