import { type RefObject, useCallback, useRef, useState } from 'react';
import { usePointerDrag } from '../../lib/usePointerDrag';
import { useWheel } from '../../lib/useWheel';
import { parseTyped, stepField } from './numberStep';

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

  const commitText = () => {
    if (text != null) {
      const v = parseTyped(text);
      if (!Number.isNaN(v)) {
        onChange(clamp(v));
      }
    }
    setText(null);
  };

  // ↑ / ↓, the wheel and − / + step from what the field shows (the typed
  // number while editing, which then follows the step)
  const bump = (dir: 1 | -1) => {
    const next = stepField(text, value, dir * step, clamp, decimals);
    if (next.text != null) {
      setText(next.text);
    }
    onChange(next.value);
  };

  // Wheel must be non-passive to stop the panel from scrolling instead.
  useWheel(inputRef, (e) => {
    if (disabled) {
      return;
    }
    e.preventDefault();
    bump(e.deltaY < 0 ? 1 : -1);
  });

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
