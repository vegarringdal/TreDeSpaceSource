import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type NumberInputControl = Readonly<{
  /** Non-null while the field is being typed in. */
  text: string | null;
  setText: (t: string | null) => void;
  commitText: () => void;
  bump: (dir: 1 | -1) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isDragging: () => boolean;
  onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLInputElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => void;
}>;

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
  const drag = useRef<{ x: number; start: number; rolled: boolean } | null>(null);
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

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    // Dragging while focused would fight text selection — rolling starts unfocused.
    if (disabled || document.activeElement === inputRef.current) {
      return;
    }
    // Block native focus + text selection while rolling; a plain click gets
    // focused manually on pointerup instead.
    e.preventDefault();
    drag.current = { x: e.clientX, start: value, rolled: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current;
    if (!d) {
      return;
    }
    const dx = e.clientX - d.x;
    if (!d.rolled && Math.abs(dx) < 4) {
      return;
    }
    d.rolled = true;
    e.preventDefault();
    onChange(clamp(d.start + Math.round(dx / 4) * step));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d?.rolled) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      e.preventDefault();
    } else if (d) {
      inputRef.current?.focus(); // plain click → start editing (onFocus fills the text)
    }
  };

  const bump = (dir: 1 | -1) => onChange(clamp(value + dir * step));

  return {
    text,
    setText,
    commitText,
    bump,
    inputRef,
    isDragging: () => drag.current != null,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
