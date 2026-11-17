import { cn } from '@treDeSpaceUI/lib/cn';
import { render } from 'lit-html';
import { useEffect, useRef, useState } from 'react';
import { smoothstep } from '../../../lib/animation/interp';
import { renderOverlay } from '../../../lib/overlay/overlayTemplate';
import type { OverlayComponent, OverlayTheme } from '../../../lib/overlay/overlayTypes';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';
import { OverlayPreviewToolbar } from './OverlayPreviewToolbar';
import { registerOverlayPreviewReplay } from './overlayEditorPanel';

/** Fixed sample playback position for {{step.index}} / {{time}} etc. */
const SAMPLE_STEP_INDEX = 3;
const SAMPLE_STEP_COUNT = 12;
const SAMPLE_TIME_S = 12.4;
const SAMPLE_DURATION_S = 90;

const BG_CLS = {
  scene: 'bg-slate-700',
  dark: 'bg-slate-800',
  light: 'bg-slate-200',
  checker: 'bg-[conic-gradient(#334155_25%,#1e293b_0_50%,#334155_0_75%,#1e293b_0)] bg-[length:16px_16px]',
} as const;

/** Smallest box height the preview scales against (a squeezed panel). */
const MIN_BOX_PX = 80;
/** Fit: share of the box the card may fill, and the largest zoom. */
const FIT_SHARE = 0.85;
const FIT_MAX_SCALE = 4;

/** Live preview: the SAME renderOverlay the viewport uses, scaled as on a
 *  viewport of the chosen height — the preview box stands in for that
 *  viewport, so it fills its panel; ▶ replays the enter effect. */
export function OverlayPreview({ component, theme }: { component: OverlayComponent; theme: OverlayTheme | null }) {
  const s = overlayEditorState.use();
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(1);
  const [boxSize, setBoxSize] = useState<[number, number]>([MIN_BOX_PX, MIN_BOX_PX]);
  const [cardSize, setCardSize] = useState<[number, number]>([1, 1]);
  const scale =
    s.previewHeight === 'fit'
      ? Math.min(
          FIT_MAX_SCALE,
          (boxSize[0] * FIT_SHARE) / Math.max(1, cardSize[0]),
          (boxSize[1] * FIT_SHARE) / Math.max(1, cardSize[1]),
        )
      : Math.max(MIN_BOX_PX, boxSize[1]) / s.previewHeight;

  // box = the stand-in viewport; host = the card at its unscaled size (layout
  // sizes ignore the zoom transform). Observed, not read once: a preview
  // mounted in a hidden tab measures 0 until it is shown.
  useEffect(() => {
    const el = box.current;
    const card = host.current;
    if (!el || !card) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setBoxSize([el.clientWidth, el.clientHeight]);
      setCardSize([card.offsetWidth, card.offsetHeight]);
    });
    ro.observe(el);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const sc = s.sampleContext;
    const ctx = {
      step: { name: sc.stepName, text: sc.stepText, index: SAMPLE_STEP_INDEX, count: SAMPLE_STEP_COUNT },
      objectName: sc.objectName,
      time: SAMPLE_TIME_S,
      duration: SAMPLE_DURATION_S,
    };
    render(renderOverlay(component, s.sample, theme, ctx, { selectedBlock: s.selectedBlock }), host.current);
  }, [component, theme, s.sample, s.sampleContext, s.selectedBlock]);

  const replay = () => {
    const fx = s.previewFx;
    const dur = fx.kind === 'none' ? 0.3 : fx.duration;
    const t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / 1000 / Math.max(0.05, dur));
      setProgress(u);
      if (u < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };

  useEffect(() => {
    registerOverlayPreviewReplay(replay);
    return () => registerOverlayPreviewReplay(null);
  });

  const e = smoothstep(progress);
  const fxScale = s.previewFx.kind === 'pop' ? 0.8 + 0.2 * e : 1;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-1.5">
      <OverlayPreviewToolbar onReplay={replay} />
      <div
        ref={box}
        className={cn(
          'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-slate-700',
          BG_CLS[s.previewBg],
        )}
      >
        <div
          className="shrink-0"
          style={{
            transform: `scale(${(scale * fxScale).toFixed(4)})`,
            opacity: s.previewFx.kind === 'none' ? 1 : e,
            transformOrigin: 'center',
          }}
        >
          <div ref={host} className="w-max" />
        </div>
      </div>
    </div>
  );
}
