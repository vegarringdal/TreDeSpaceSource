import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ColorSelectPopover } from './ColorSelectPopover';
import { type HSV, hexToRgb, hsvToRgb, isHex, rgbToHex, rgbToHsv } from './colorConversions';
import { getSwatches, subscribeSwatches } from './colorSelectSwatches';
import { useColorPopover } from './useColorPopover';

export {
  type ColorSelectSwatchesStore,
  DEFAULT_PICKER_SWATCHES,
  setColorSelectSwatchesStore,
} from './colorSelectSwatches';

export interface ColorSelectProps {
  value: string;
  onChange: (color: string) => void;
  /** Quick-pick row at the bottom of the popover. */
  swatches?: string[];
  disabled?: boolean;
  className?: string;
  /** Fill the parent height exactly (ribbon slots) instead of the h-6 floor. */
  flush?: boolean;
}

/**
 * The one colour picker: saturation/value area + hue bar, with hex and RGB
 * entry, quick swatches, popover portaled to body. HSV lives locally while
 * open so hue survives passing through black/white/grey.
 */
export function ColorSelect({
  value,
  onChange,
  swatches,
  disabled = false,
  className = '',
  flush = false,
}: ColorSelectProps) {
  // default swatch grid comes from the injected store, if any (in this app:
  // user-editable via Settings → Editor)
  const storeSwatches = useSyncExternalStore(subscribeSwatches, getSwatches);
  const quickSwatches = swatches ?? storeSwatches;
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(isHex(value) ? value : '#000000')));
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const pos = useColorPopover(open, setOpen, rootRef, popRef);

  const rgb = hsvToRgb(hsv);
  const hex = rgbToHex(rgb);

  // Adopt outside changes (swatches elsewhere, store resets) without losing hue.
  useEffect(() => {
    if (isHex(value) && value.toLowerCase() !== hex.toLowerCase()) {
      const next = rgbToHsv(hexToRgb(value));
      setHsv((cur) => (next.s === 0 ? { ...next, h: cur.h } : next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, hex.toLowerCase]);

  const apply = (next: HSV) => {
    setHsv(next);
    onChange(rgbToHex(hsvToRgb(next)));
  };

  return (
    <div ref={rootRef} className={`relative text-xs ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-full ${flush ? '' : 'min-h-6'} w-full cursor-pointer items-center gap-2 border px-2 py-0 text-left text-slate-200 ${
          open ? 'border-blue-400 bg-slate-900' : 'border-slate-700 bg-slate-900 hover:border-slate-600'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="h-3.5 w-6 shrink-0 border border-black/40" style={{ background: value }} />
        <span className="flex-1 truncate font-mono">{value}</span>
        <svg
          viewBox="0 0 8 8"
          className={`h-2 w-2 shrink-0 fill-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M0 2l4 4 4-4z" />
        </svg>
      </button>

      {open &&
        createPortal(
          <ColorSelectPopover
            hsv={hsv}
            rgb={rgb}
            hex={hex}
            apply={apply}
            quickSwatches={quickSwatches}
            pos={pos}
            popRef={popRef}
            svRef={svRef}
            hueRef={hueRef}
          />,
          document.body,
        )}
    </div>
  );
}
