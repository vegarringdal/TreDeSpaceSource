import { cn } from '../../lib/cn';
import type { LabelledProps } from '../fieldChrome';
import { SegmentedControl } from '../SegmentedControl';

export interface EasingOption<E extends string> {
  /** The easing this segment picks. */
  value: E;
  /** Name of the easing — the segment's tooltip, and its text with `showLabels`. */
  label: string;
  /** The curve for the preview glyph: progress 0..1 → eased 0..1. */
  curve: (u: number) => number;
  /** Hotkey id (data-shortcut) of this choice — its tooltip gets a combo
   *  footer. */
  shortcut?: string;
}

export interface EasingSelectProps<E extends string> extends Pick<LabelledProps, 'disabled' | 'className'> {
  /** The selected easing. */
  value: E;
  /** The choices, left to right — you supply each curve. */
  options: readonly EasingOption<E>[];
  /** Receives the clicked easing. */
  onChange: (value: E) => void;
  /** Show the label next to each glyph (default: glyph only + tooltip). */
  showLabels?: boolean;
}

const GLYPH = 14;

/** A tiny polyline of the curve, drawn in the segment's text colour. */
function CurveGlyph({ curve }: { curve: (u: number) => number }) {
  const n = 12;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const v = Math.min(1, Math.max(0, curve(u)));
    return `${(1 + u * (GLYPH - 2)).toFixed(2)},${(GLYPH - 1 - v * (GLYPH - 2)).toFixed(2)}`;
  }).join(' ');
  return (
    <svg width={GLYPH} height={GLYPH} viewBox={`0 0 ${GLYPH} ${GLYPH}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Pick an easing curve: a segmented row of curve glyphs (linear, ease in, …)
 * so the choice is visible, not just named. Generic over the value union —
 * the caller supplies the curves.
 */
export function EasingSelect<E extends string>({
  value,
  options,
  onChange,
  showLabels = false,
  disabled = false,
  className = '',
}: EasingSelectProps<E>) {
  return (
    <SegmentedControl
      className={cn(className)}
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={options.map((o) => ({
        value: o.value,
        icon: <CurveGlyph curve={o.curve} />,
        label: showLabels ? o.label : undefined,
        tooltip: o.label,
        shortcut: o.shortcut,
      }))}
    />
  );
}
