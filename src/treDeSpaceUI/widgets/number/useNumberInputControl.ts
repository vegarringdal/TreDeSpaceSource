import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { usePointerDrag } from '../../lib/usePointerDrag';

export type NumberInputControl = Readonly<{
  /** Non-null while the field is being typed in. */
  text: string | null;
  setText: (t: string | null) => void;
  commitText: () => void;
  bump: (dir: 1 | -1) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isDragging: () => boolean;
  onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => void;
}>;

/** px of travel before a press becomes a roll rather than a click. */
const ROLL_THRESHOLD_PX = 4;
/** px of horizontal travel per step while rolling. */
const ROLL_PX_PER_STEP = 4;

/**
 * The stepper's interaction engine: clamped commits, non-passive wheel
 * stepping, and Blender-style horizontal "rolling" (press + drag while
 * unfocused; a plain click focuses for typing instead).
 */
export function useNumberInputControl(
  value: number,
  onChange: (value: number) => void,
  step: number,
  decimals: number,
  min: number | undefined,
  max: number | undefined,
  disabled: boolean,
): NumberInputControl {
  const clamp = useCallback(
    (v: number) => {
      const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
      return +c.toFixed(decimals);
    },
    [min, max, decimals],
  );

  const [text, setText] = useState<string | null>(null); // non-null while editing
  const inputRef = useRef<HTMLInputElement>(null);
  const rollFrom = useRef(value);
  const latest = useRef({ value, onChange, disabled });
  latest.current = { value, onChange, disabled };

  const commitText = () => {
    if (text != null) {
      const v = parseFloat(text.replace(',', '.'));
      if (!Number.isNaN(v)) {
        onChange(clamp(v));
      }
    }
    setText(null);
  };

  // Wheel must be non-passive to stop the panel from scrolling instead.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      if (latest.current.disabled) {
        return;
      }
      e.preventDefault();
      latest.current.onChange(clamp(latest.current.value + (e.deltaY < 0 ? step : -step)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step, clamp]);

  const drag = usePointerDrag({
    threshold: ROLL_THRESHOLD_PX,
    onMove: (d, e) => {
      e.preventDefault();
      onChange(clamp(rollFrom.current + Math.round(d.dx / ROLL_PX_PER_STEP) * step));
    },
    onEnd: (moved) => {
      if (!moved) {
        inputRef.current?.focus(); // plain click → start editing (onFocus fills the text)
      }
    },
  });

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    // Dragging while focused would fight text selection — rolling starts unfocused.
    if (disabled || document.activeElement === inputRef.current) {
      return;
    }
    // Block native focus + text selection while rolling; a plain click gets
    // focused manually when the press ends without movement.
    e.preventDefault();
    rollFrom.current = value;
    drag.start(e);
  };

  const bump = (dir: 1 | -1) => onChange(clamp(value + dir * step));

  return {
    text,
    setText,
    commitText,
    bump,
    inputRef,
    isDragging: drag.isDragging,
    onPointerDown,
  };
}
