// -----------------------------------------------------------------------------
// overlay style mapping (DESIGN.md › Animation › Overlays, D13)
// -----------------------------------------------------------------------------
// Whitelisted style fields → inline CSS, written in code. Every colour goes
// through resolveColor (hex / rgb() / $token, else a fallback) and every
// number is clamped, so a doc can never smuggle a declaration in. Inline
// styles only — the rendered card must stand alone when it is serialized
// into an SVG for capture (no classes, no stylesheet). Fonts are SYSTEM
// stacks: an SVG drawn as an image cannot use the page's web fonts.

import { resolveColor } from './overlaySafety';
import type { BoxStyle, FlexLayout, FontFamily, Shadow, TextStyle } from './overlayTypes';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

export const FONT_STACKS: Readonly<Record<FontFamily, string>> = {
  ui: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  serif: "Georgia, 'Times New Roman', 'Liberation Serif', serif",
};

const SHADOWS: Readonly<Record<Shadow, string>> = {
  none: 'none',
  sm: '0 1px 3px rgba(0,0,0,0.35)',
  md: '0 4px 12px rgba(0,0,0,0.4)',
  lg: '0 10px 30px rgba(0,0,0,0.45)',
};

const ALIGN: Readonly<Record<FlexLayout['align'], string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

const JUSTIFY: Readonly<Record<FlexLayout['justify'], string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};

/** Default theme tokens when an instance has no theme. */
export const DEFAULT_TOKENS: Readonly<Record<string, string>> = {
  bg: '#0f172a',
  surface: '#1e293b',
  text: '#f8fafc',
  muted: '#94a3b8',
  accent: '#38bdf8',
  warning: '#f59e0b',
  danger: '#ef4444',
  success: '#22c55e',
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const px = (n: number, lo = 0, hi = 4000): string => `${Math.min(hi, Math.max(lo, n))}px`;

function sidesCss(s: readonly number[]): string {
  return s.map((n) => px(n, -400, 400)).join(' ');
}

function sizeCss(prop: 'width' | 'height', v: BoxStyle['width']): string {
  if (v === undefined || v === 'auto') {
    return '';
  }
  if (v === 'fill') {
    return prop === 'width' ? 'width:100%;flex:1 1 auto;' : 'height:100%;';
  }
  return `${prop}:${px(v)};`;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Inline CSS for a box-like block. */
export function boxCss(s: BoxStyle, tokens: Readonly<Record<string, string>>): string {
  let css = 'box-sizing:border-box;';
  if (s.bg !== undefined) {
    css += `background:${resolveColor(s.bg, tokens, 'transparent')};`;
  }
  if (s.opacity !== undefined) {
    css += `opacity:${Math.min(1, Math.max(0, s.opacity))};`;
  }
  if (s.padding) {
    css += `padding:${sidesCss(s.padding)};`;
  }
  if (s.margin) {
    css += `margin:${sidesCss(s.margin)};`;
  }
  if (s.border && s.border.width > 0) {
    css += `border:${px(s.border.width, 0, 40)} ${s.border.style === 'dashed' ? 'dashed' : 'solid'} ${resolveColor(s.border.color, tokens, 'transparent')};`;
  }
  if (s.radius !== undefined) {
    css += `border-radius:${px(s.radius, 0, 400)};`;
  }
  if (s.shadow && s.shadow !== 'none') {
    css += `box-shadow:${SHADOWS[s.shadow]};`;
  }
  css += sizeCss('width', s.width) + sizeCss('height', s.height);
  return css;
}

/** Inline CSS for a flex container (box blocks). */
export function layoutCss(l: FlexLayout): string {
  return (
    `display:flex;flex-direction:${l.dir === 'row' ? 'row' : 'column'};gap:${px(l.gap, 0, 400)};` +
    `align-items:${ALIGN[l.align]};justify-content:${JUSTIFY[l.justify]};`
  );
}

/** Range of an overlay's text-size multiplier. */
export const TEXT_SCALE_MIN = 0.25;
export const TEXT_SCALE_MAX = 4;

/** Default font size (px at the design height). */
export const DEFAULT_TEXT_SIZE = 16;

/** A text style's font size: its number, or the card's number value it is
 *  bound to (`{{key}}`, found in `tokens` under that name). */
export function fontSize(s: TextStyle, tokens: Readonly<Record<string, string>>): number {
  const v = typeof s.size === 'string' ? Number(tokens[s.size]) : (s.size ?? DEFAULT_TEXT_SIZE);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TEXT_SIZE;
}

/** Inline CSS for text-like blocks; `textScale` multiplies the font size
 *  (the design's and the placed card's text size). */
export function textCss(s: TextStyle, tokens: Readonly<Record<string, string>>, textScale = 1): string {
  let css = `font-family:${FONT_STACKS[s.font ?? 'ui']};`;
  css += `color:${resolveColor(s.color ?? '$text', tokens, '#ffffff')};`;
  css += `font-size:${px(fontSize(s, tokens) * textScale, 4, 400)};`;
  css += `font-weight:${s.weight ?? 400};`;
  css += `line-height:${Math.min(4, Math.max(0.5, s.lineHeight ?? 1.3))};`;
  if (s.align) {
    css += `text-align:${s.align};`;
  }
  if (s.maxLines && s.maxLines > 0) {
    css += `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${Math.min(50, s.maxLines)};overflow:hidden;`;
  }
  css += 'white-space:pre-wrap;overflow-wrap:anywhere;margin:0;';
  return css;
}

/** Theme tokens merged over the defaults. */
export function themeTokens(theme: { tokens: Readonly<Record<string, string>> } | null): Record<string, string> {
  return { ...DEFAULT_TOKENS, ...(theme?.tokens ?? {}) };
}
