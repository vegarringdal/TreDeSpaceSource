import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const MIN_LABEL_PX = 80;
const MAX_LABEL_PX = 600;
const KEY_STEP_PX = 10;

const clamp = (px: number) => Math.round(Math.min(MAX_LABEL_PX, Math.max(MIN_LABEL_PX, px)));

/** The label column's right edge as a drag handle (Timeline's
 *  `onLabelWidthChange`): drag to widen or narrow the names; focused, ←/→
 *  step it. */
export function LabelWidthHandle({ width, onChange }: { width: number; onChange: (px: number) => void }) {
  const handleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onChange(clamp(width + ev.clientX - x0));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const handleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      onChange(clamp(width + (e.key === 'ArrowRight' ? KEY_STEP_PX : -KEY_STEP_PX)));
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Name column width"
      aria-valuenow={width}
      aria-valuemin={MIN_LABEL_PX}
      aria-valuemax={MAX_LABEL_PX}
      data-tooltip="Drag to widen or narrow the names"
      className="absolute top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-sky-500/40"
      style={{ left: width - 3 }}
      onPointerDown={handleDown}
      onKeyDown={handleKey}
    />
  );
}
