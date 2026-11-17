import { useRef } from 'react';
import { cn } from '../../lib/cn';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

export interface ClockDialProps {
  mode: 'hour' | 'minute';
  hour: number;
  minute: number;
  /** Snap picked minutes to this step (1 = exact). */
  minuteStep: number;
  onPick: (mode: 'hour' | 'minute', value: number) => void;
  /** Pointer released / value clicked — the picker advances hour→minute→done. */
  onCommit: () => void;
}

const SIZE = 200;
const CENTER = SIZE / 2;
const R_FACE = 96;
const R_OUTER = 78;
const R_INNER = 50;

// Android's 24-hour dial: 1–12 on the outer ring (12 at the top), 00 and
// 13–23 on the inner ring (00 at the top). Index = clockwise position.
const OUTER_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const INNER_HOURS = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Position on the dial for a clockwise angle (degrees, 0 = top). */
function point(deg: number, radius: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) };
}

/** The selected value's dial position: clockwise angle + ring radius. */
function selectedPos(mode: 'hour' | 'minute', hour: number, minute: number): { deg: number; radius: number } {
  if (mode === 'minute') {
    return { deg: minute * 6, radius: R_OUTER };
  }
  const outerIdx = OUTER_HOURS.indexOf(hour);
  if (outerIdx >= 0) {
    return { deg: outerIdx * 30, radius: R_OUTER };
  }
  return { deg: INNER_HOURS.indexOf(hour) * 30, radius: R_INNER };
}

/** Map a pointer position to the value under it. */
function valueAt(mode: 'hour' | 'minute', x: number, y: number, minuteStep: number): number {
  const dx = x - CENTER;
  const dy = y - CENTER;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI + 360;
  if (mode === 'hour') {
    const idx = Math.round(deg / 30) % 12;
    const outer = Math.hypot(dx, dy) >= (R_OUTER + R_INNER) / 2;
    return outer ? OUTER_HOURS[idx] : INNER_HOURS[idx];
  }
  const snapped = Math.round(Math.round(deg / 6) / minuteStep) * minuteStep;
  return snapped % 60;
}

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

/** The analog dial of TimePicker: drag or click to pick; hours use the
 *  Android 24-hour dual ring, minutes a single ring with 5-minute labels. */
export function ClockDial({ mode, hour, minute, minuteStep, onPick, onCommit }: ClockDialProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);

  const pickFromEvent = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) {
      return;
    }
    onPick(mode, valueAt(mode, e.clientX - r.left, e.clientY - r.top, minuteStep));
  };

  const sel = selectedPos(mode, hour, minute);
  const knob = point(sel.deg, sel.radius);
  const labels =
    mode === 'hour'
      ? [
          ...OUTER_HOURS.map((h, i) => ({ v: h, deg: i * 30, radius: R_OUTER, dim: false, hot: h === hour })),
          ...INNER_HOURS.map((h, i) => ({ v: h, deg: i * 30, radius: R_INNER, dim: true, hot: h === hour })),
        ]
      : Array.from({ length: 12 }, (_, i) => ({
          v: i * 5,
          deg: i * 30,
          radius: R_OUTER,
          dim: false,
          hot: i * 5 === minute,
        }));

  return (
    <svg
      ref={svgRef}
      width={SIZE}
      height={SIZE}
      className="touch-none select-none"
      onPointerDown={(e) => {
        isDragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        pickFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (isDragging.current) {
          pickFromEvent(e);
        }
      }}
      onPointerUp={() => {
        isDragging.current = false;
        onCommit();
      }}
    >
      <title>{mode === 'hour' ? 'Pick hour' : 'Pick minute'}</title>
      <circle cx={CENTER} cy={CENTER} r={R_FACE} className="fill-slate-800" />
      <line x1={CENTER} y1={CENTER} x2={knob.x} y2={knob.y} strokeWidth={2} className="stroke-blue-400" />
      <circle cx={knob.x} cy={knob.y} r={13} className="fill-blue-400" />
      <circle cx={CENTER} cy={CENTER} r={3} className="fill-blue-400" />
      {labels.map((l) => {
        const p = point(l.deg, l.radius);
        return (
          <text
            key={`${l.radius}-${l.v}`}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            className={cn(
              'text-[11px]',
              l.hot ? 'fill-slate-950 font-semibold' : l.dim ? 'fill-slate-500 text-[10px]' : 'fill-slate-200',
            )}
          >
            {l.v < 10 && (mode === 'minute' || l.dim) ? `0${l.v}` : l.v}
          </text>
        );
      })}
    </svg>
  );
}
