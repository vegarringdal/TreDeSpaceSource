import { Button } from '@treDeSpaceUI/widgets';
import { suggestVramBudgetMb } from '../../../../lib/render/vramHint';
import { getRenderer, viewerActions } from '../../../../state/viewer/viewer.actions';

/** "Suggested for this GPU: N MB" under Max VRAM — shown only when the
 *  adapter is an integrated or mobile part, where a quarter of system RAM is
 *  a fair guess; discrete cards get no suggestion (WebGPU cannot see their
 *  VRAM). Never applied automatically. */
export function VramSuggestedRow({ current, enabled }: { current: number; enabled: boolean }) {
  const suggested = suggestVramBudgetMb(getRenderer()?.adapterHints ?? null);
  if (suggested === null) {
    return null;
  }

  const inUse = enabled && current === suggested;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 truncate text-slate-400">Suggested</span>
      <span className="ml-auto text-slate-400">{suggested} MB for this GPU</span>
      <Button
        disabled={inUse}
        tooltip="Enable the budget with Max VRAM at the suggestion — a quarter of system RAM, clamped to what an integrated GPU can use"
        shortcut="render.vramUseSuggested"
        onClick={() => viewerActions.update({ maxVramMb: suggested, vramBudgetOn: true })}
      >
        {inUse ? 'In use' : 'Use'}
      </Button>
    </div>
  );
}
