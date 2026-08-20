import { useState } from 'react';
import { type HSV, hexToRgb, isHex, type RGB, rgbToHsv } from './colorConversions';

const inputCls =
  'w-full min-w-0 border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs text-slate-200 outline-none focus:border-blue-400';

/** Hex + R/G/B entry row; text state stays local while a field is edited so
 *  half-typed values don't fight the live color. */
export function ColorFields({ hex, rgb, apply }: { hex: string; rgb: RGB; apply: (next: HSV) => void }) {
  const [hexText, setHexText] = useState<string | null>(null); // non-null while editing
  const [rgbText, setRgbText] = useState<Partial<Record<'r' | 'g' | 'b', string>>>({});

  const commitHex = () => {
    if (hexText != null) {
      const h = hexText.startsWith('#') ? hexText : `#${hexText}`;
      if (isHex(h)) {
        apply(rgbToHsv(hexToRgb(h)));
      }
    }
    setHexText(null);
  };

  const commitRgb = (k: 'r' | 'g' | 'b') => {
    const t = rgbText[k];
    if (t != null) {
      const n = parseInt(t, 10);
      if (!Number.isNaN(n)) {
        apply(rgbToHsv({ ...rgb, [k]: Math.min(255, Math.max(0, n)) }));
      }
    }
    setRgbText((s) => ({ ...s, [k]: undefined }));
  };

  return (
    <div className="mt-2 grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-1">
      <input
        value={hexText ?? hex}
        spellCheck={false}
        className={inputCls}
        onChange={(e) => setHexText(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => e.key === 'Enter' && commitHex()}
      />
      {(['r', 'g', 'b'] as const).map((k) => (
        <input
          key={k}
          value={rgbText[k] ?? Math.round(rgb[k])}
          inputMode="numeric"
          className={inputCls}
          onChange={(e) => setRgbText((s) => ({ ...s, [k]: e.target.value }))}
          onBlur={() => commitRgb(k)}
          onKeyDown={(e) => e.key === 'Enter' && commitRgb(k)}
        />
      ))}
      <span className="text-center text-slate-400 text-xs">Hex</span>
      <span className="text-center text-slate-400 text-xs">R</span>
      <span className="text-center text-slate-400 text-xs">G</span>
      <span className="text-center text-slate-400 text-xs">B</span>
    </div>
  );
}
