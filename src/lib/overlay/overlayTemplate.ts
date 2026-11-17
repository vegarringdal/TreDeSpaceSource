// -----------------------------------------------------------------------------
// overlay renderer (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// renderOverlay() turns a component + instance values into a lit-html
// template: text is always interpolated as TEXT (lit escapes it), rich text
// is split into **bold** spans and line breaks by code, styles come from the
// whitelist mapping, images must pass isSafeImage, icons come from the fixed
// set. The same function renders the Overlay Editor preview and the viewport
// layer, and the result is self-contained (inline styles, system fonts) so a
// screenshot can serialize it into an SVG foreignObject.

import { html, nothing, svg, type TemplateResult } from 'lit-html';
import { isShown, makeResolver, progressValue, soleParam, substitute } from './overlayBindings';
import { overlayIcon } from './overlayIcons';
import { isSafeImage, resolveColor } from './overlaySafety';
import { boxCss, fontSize, layoutCss, textCss, themeTokens } from './overlayStyle';
import type {
  BindingContext,
  FlexLayout,
  OverlayBlock,
  OverlayComponent,
  OverlayTheme,
  OverlayValue,
} from './overlayTypes';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface RenderOptions {
  /** mark text blocks bound to one param (`{{key}}`) as editable in place */
  editable?: boolean;
  /** highlight one block (editor selection) */
  selectedBlock?: string | null;
  /** multiplies every text size (the instance's text size; default 1) */
  textScale?: number;
}

interface Ctx {
  resolve: (key: string) => OverlayValue;
  tokens: Record<string, string>;
  opts: RenderOptions;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Widest an auto-width card may grow unless it sets its own max (design px). */
export const AUTO_MAX_WIDTH = 640;
const SELECTED_OUTLINE = 'outline:2px dashed #38bdf8;outline-offset:2px;';
/** An icon's size when its style sets none (px at the design height). */
const ICON_SIZE = 20;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** **bold** spans and newlines as template parts — never as markup strings. */
function richText(text: string): TemplateResult[] {
  return text.split('\n').map((line, i) => {
    const parts = line.split('**');
    const spans = parts.map((p, k) => (k % 2 === 1 ? html`<b>${p}</b>` : html`${p}`));
    return i === 0 ? html`${spans}` : html`<br />${spans}`;
  });
}

/** A text block with its own alignment takes the parent's full width (column)
 *  or the free room (row) — else it is only as wide as its words and the
 *  alignment shows nowhere but on the widest line. */
function alignRoom(b: OverlayBlock, parentDir: FlexLayout['dir'] | null): string {
  if (b.kind !== 'text' || !b.style.align || !parentDir) {
    return '';
  }
  return parentDir === 'row' ? 'flex:1 1 auto;' : 'align-self:stretch;';
}

function renderBlock(
  b: OverlayBlock,
  c: Ctx,
  parentDir: FlexLayout['dir'] | null = null,
): TemplateResult | typeof nothing {
  if (!isShown(b, c.resolve)) {
    return nothing;
  }
  const selected = c.opts.selectedBlock === b.id ? SELECTED_OUTLINE : '';
  switch (b.kind) {
    case 'box':
      return html`<div data-block=${b.id} style=${boxCss(b.style, c.tokens) + layoutCss(b.layout) + selected}>
        ${b.children.map((child) => renderBlock(child, c, b.layout.dir))}
      </div>`;
    case 'text': {
      const value = substitute(b.text, c.resolve);
      const param = c.opts.editable ? soleParam(b.text) : null;
      return html`<div
        data-block=${b.id}
        data-param=${param ?? nothing}
        style=${textCss(b.style, c.tokens, c.opts.textScale) + alignRoom(b, parentDir) + selected + (param ? 'cursor:text;' : '')}
      >${b.rich ? richText(value) : value}</div>`;
    }
    case 'image': {
      const src = substitute(b.src, c.resolve);
      if (!isSafeImage(src)) {
        return nothing; // D13: data: images only, re-checked at draw time
      }
      return html`<img
        data-block=${b.id}
        alt=""
        src=${src}
        style=${`${boxCss(b.style, c.tokens)}object-fit:${b.fit === 'cover' ? 'cover' : 'contain'};display:block;${selected}`}
      />`;
    }
    case 'icon': {
      const icon = overlayIcon(substitute(b.icon, c.resolve));
      const size = Math.min(200, Math.max(8, b.style.size === undefined ? ICON_SIZE : fontSize(b.style, c.tokens)));
      const color = resolveColor(b.style.color ?? '$accent', c.tokens, '#38bdf8');
      return html`<svg
        data-block=${b.id}
        width=${size}
        height=${size}
        viewBox="0 0 24 24"
        fill="none"
        stroke=${color}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style=${`flex:none;display:block;${selected}`}
      >
        ${icon.paths.map((d) => svg`<path d=${d}></path>`)}
      </svg>`;
    }
    case 'divider':
      return html`<div
        data-block=${b.id}
        style=${`height:1px;background:${resolveColor(b.style.bg ?? '$muted', c.tokens, '#94a3b8')};${boxCss({ ...b.style, bg: undefined }, c.tokens)}${selected}`}
      ></div>`;
    case 'progress': {
      const v = progressValue(substitute(b.value, c.resolve));
      const track = resolveColor(b.style.bg ?? '$surface', c.tokens, '#1e293b');
      const fill = resolveColor(b.style.border?.color ?? '$accent', c.tokens, '#38bdf8');
      const h = typeof b.style.height === 'number' ? b.style.height : 6;
      return html`<div
        data-block=${b.id}
        style=${`height:${h}px;background:${track};border-radius:${h}px;overflow:hidden;${boxCss({ ...b.style, bg: undefined, border: undefined, height: undefined }, c.tokens)}${selected}`}
      >
        <div style=${`height:100%;width:${(v * 100).toFixed(2)}%;background:${fill};`}></div>
      </div>`;
    }
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Theme colours plus the card's colour and number values under their
 *  `{{key}}` names — where styles bound to a value read it (resolveColor,
 *  fontSize). Theme token names cannot hold braces, so the two never clash. */
function styleTokens(
  component: OverlayComponent,
  theme: OverlayTheme | null,
  resolve: (key: string) => OverlayValue,
): Record<string, string> {
  const out = themeTokens(theme);
  for (const p of component.params) {
    if (p.type === 'color' || p.type === 'number') {
      const v = resolve(p.key);
      if (v !== null && v !== '') {
        out[`{{${p.key}}}`] = String(v);
      }
    }
  }
  return out;
}

/** The card for one instance: root block inside a sized wrapper. The
 *  design's text size and the instance's multiply. */
export function renderOverlay(
  component: OverlayComponent,
  values: Readonly<Record<string, OverlayValue>>,
  theme: OverlayTheme | null,
  ctx: BindingContext,
  opts: RenderOptions = {},
): TemplateResult {
  const resolve = makeResolver(component, values, ctx);
  const textScale = (opts.textScale ?? 1) * (component.textScale ?? 1);
  const c: Ctx = { resolve, tokens: styleTokens(component, theme, resolve), opts: { ...opts, textScale } };
  const { width: w, height: h, minWidth = 0, maxWidth = AUTO_MAX_WIDTH } = component.size;
  const size =
    // max-content: an auto card's width must not depend on its container — the
    // viewport's foreignObject starts 1 px wide, and shrink-to-fit there wraps
    // text letter by letter (overflow-wrap:anywhere), which measure() then keeps
    (w === 'auto'
      ? `width:max-content;min-width:${Math.min(4000, minWidth)}px;max-width:${Math.min(4000, Math.max(minWidth, maxWidth))}px;`
      : `width:${Math.min(4000, w)}px;`) + (h === 'auto' ? '' : `height:${Math.min(4000, h)}px;`);
  return html`<div style=${`display:inline-block;box-sizing:border-box;${size}`}>${renderBlock(component.root, c)}</div>`;
}
