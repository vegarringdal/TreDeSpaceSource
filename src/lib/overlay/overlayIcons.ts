// -----------------------------------------------------------------------------
// overlay icon set (DESIGN.md › Animation › Overlays — "icons from a fixed list")
// -----------------------------------------------------------------------------
// 24×24 stroke glyphs drawn as inline SVG inside the card, so a captured
// overlay needs nothing from outside the document. Path data only; the
// renderer builds the <svg> with currentColor strokes.

export interface OverlayIcon {
  name: string;
  label: string;
  /** SVG path `d` strings (stroke, round caps/joins) */
  paths: readonly string[];
}

export const OVERLAY_ICONS: readonly OverlayIcon[] = [
  { name: 'info', label: 'Info', paths: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', 'M12 8h.01', 'M11 12h1v4h1'] },
  { name: 'warning', label: 'Warning', paths: ['M12 3l9.5 17h-19z', 'M12 10v4', 'M12 17h.01'] },
  { name: 'check', label: 'Check', paths: ['M5 12l5 5l10-10'] },
  { name: 'step', label: 'Step', paths: ['M4 6h16', 'M4 12h10', 'M4 18h6', 'M17 15l3 3l-3 3'] },
  { name: 'arrowRight', label: 'Arrow right', paths: ['M5 12h14', 'M13 6l6 6l-6 6'] },
  { name: 'arrowDown', label: 'Arrow down', paths: ['M12 5v14', 'M6 13l6 6l6-6'] },
  { name: 'arrowUp', label: 'Arrow up', paths: ['M12 19V5', 'M6 11l6-6l6 6'] },
  { name: 'rotate', label: 'Rotate', paths: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'] },
  {
    name: 'wrench',
    label: 'Wrench',
    paths: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6l-2.4-.6l-.6-2.4z'],
  },
  { name: 'bolt', label: 'Bolt', paths: ['M13 3L4 14h7l-1 7l9-11h-7z'] },
  { name: 'clock', label: 'Clock', paths: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', 'M12 7v5l3 3'] },
  { name: 'flag', label: 'Flag', paths: ['M5 21V4', 'M5 4h11l-2 4l2 4H5'] },
  {
    name: 'eye',
    label: 'Eye',
    paths: ['M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7s-10-7-10-7', 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6'],
  },
  {
    name: 'hand',
    label: 'Hand',
    paths: [
      'M8 13V5a1.5 1.5 0 0 1 3 0v6',
      'M11 11V4a1.5 1.5 0 0 1 3 0v7',
      'M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.6-1.5L8 15',
    ],
  },
  { name: 'stop', label: 'Stop', paths: ['M8 3h8l5 5v8l-5 5H8l-5-5V8z', 'M12 8v5', 'M12 16h.01'] },
  { name: 'star', label: 'Star', paths: ['M12 3l2.8 5.8l6.2.9l-4.5 4.4l1 6.2L12 17.4l-5.5 2.9l1-6.2L3 9.7l6.2-.9z'] },
];

const BY_NAME = new Map(OVERLAY_ICONS.map((i) => [i.name, i]));

/** The icon of that name, or the info glyph for an unknown name. */
export function overlayIcon(name: string): OverlayIcon {
  return BY_NAME.get(name) ?? OVERLAY_ICONS[0];
}
