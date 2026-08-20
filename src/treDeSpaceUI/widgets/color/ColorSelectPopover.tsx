import type { RefObject } from 'react';
import { ColorFields } from './ColorFields';
import { type HSV, hexToRgb, type RGB, rgbToHsv } from './colorConversions';

/** Shared press-and-drag handler for the SV area and the hue bar. */
const dragArea =
  (ref: RefObject<HTMLDivElement | null>, move: (fx: number, fy: number) => void) => (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const to = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      move(
        Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      );
    };
    to(e);
    const onMove = (ev: PointerEvent) => to(ev);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

/** The picker popover body: SV area, hue bar, hex/RGB entry, quick swatches. */
export function ColorSelectPopover({
  hsv,
  rgb,
  hex,
  apply,
  quickSwatches,
  pos,
  popRef,
  svRef,
  hueRef,
}: {
  hsv: HSV;
  rgb: RGB;
  hex: string;
  apply: (next: HSV) => void;
  quickSwatches: string[];
  pos: { left: number; top: number; up: boolean };
  popRef: RefObject<HTMLDivElement | null>;
  svRef: RefObject<HTMLDivElement | null>;
  hueRef: RefObject<HTMLDivElement | null>;
}) {
  const hueCss = `hsl(${hsv.h} 100% 50%)`;

  return (
    <div
      ref={popRef}
      className="fixed z-[1000] w-52 border border-slate-700 bg-slate-900 p-2 text-slate-200 text-xs shadow-black/40 shadow-lg"
      style={{
        left: pos.left,
        top: pos.up ? undefined : pos.top + 4,
        bottom: pos.up ? window.innerHeight - pos.top + 4 : undefined,
      }}
    >
      <div
        ref={svRef}
        className="relative h-28 w-full cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueCss})`,
        }}
        onPointerDown={dragArea(svRef, (fx, fy) => apply({ ...hsv, s: fx, v: 1 - fy }))}
      >
        <span
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.6)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="h-6 w-6 shrink-0 border border-black/40" style={{ background: hex }} />
        <div
          ref={hueRef}
          className="relative h-3 flex-1 cursor-crosshair touch-none"
          style={{
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
          onPointerDown={dragArea(hueRef, (fx) => apply({ ...hsv, h: Math.min(359.9, fx * 360) }))}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 border border-black/60 bg-white"
            style={{ left: `${(hsv.h / 360) * 100}%` }}
          />
        </div>
      </div>

      <ColorFields hex={hex} rgb={rgb} apply={apply} />

      <div className="mt-2 grid grid-cols-8 gap-1 border-slate-800 border-t pt-2">
        {quickSwatches.map((c, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: user colors may repeat
            key={i}
            type="button"
            title={c}
            className={`h-4 w-4 cursor-pointer border p-0 hover:brightness-125 ${
              hex.toLowerCase() === c.toLowerCase() ? 'border-blue-400' : 'border-black/40'
            }`}
            style={{ background: c }}
            onClick={() => apply(rgbToHsv(hexToRgb(c)))}
          />
        ))}
      </div>
    </div>
  );
}
