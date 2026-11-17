// -----------------------------------------------------------------------------
// overlay design parsers (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// Components, themes, instances and effects from JSON — the overlay library,
// overlay design files and animation files share these. Strict (D13): no raw
// HTML / CSS, colours through the safety checks, `data:` images only (the
// renderer checks again at draw time). The readers throw a FieldError; the
// parse* wrappers return { error } instead.

import { arr, bool, FieldError, id, num, obj, oneOf, readField, str, v2, v3 } from '../jsonFields';
import { isSafeColor, isSafeImage, VALUE_REF_RE } from './overlaySafety';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from './overlayStyle';
import type {
  BoxStyle,
  FlexLayout,
  OverlayAnchor,
  OverlayBlock,
  OverlayComponent,
  OverlayFx,
  OverlayInstance,
  OverlayParam,
  OverlayTheme,
  OverlayValue,
  TextStyle,
} from './overlayTypes';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const PINS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'] as const;

// -----------------------------------------------------------------------------
// readers
// -----------------------------------------------------------------------------

export function color(v: unknown, path: string): string {
  const s = str(v, path);
  if (!isSafeColor(s)) {
    throw new FieldError(`${path}: not a colour (hex, rgb() or $token)`);
  }
  return s;
}

/** A style colour: a colour, or `{{key}}` — the design's colour value. */
export function styleColor(v: unknown, path: string): string {
  const s = str(v, path);
  if (VALUE_REF_RE.test(s)) {
    return s;
  }
  if (!isSafeColor(s)) {
    throw new FieldError(`${path}: not a colour (hex, rgb(), $token or {{value}})`);
  }
  return s;
}

export function sides(v: unknown, path: string): [number, number, number, number] {
  const a = arr(v, path);
  if (a.length !== 4) {
    throw new FieldError(`${path}: expected [top, right, bottom, left]`);
  }
  return [num(a[0], path), num(a[1], path), num(a[2], path), num(a[3], path)];
}

// -----------------------------------------------------------------------------
// doc parts
// -----------------------------------------------------------------------------

export function image(v: unknown, path: string): string {
  const s = str(v, path);
  if (!isSafeImage(s)) {
    throw new FieldError(`${path}: images must be data:image/png|jpeg|webp|svg+xml URIs within the size cap`);
  }
  return s;
}

export function fx(v: unknown, path: string): OverlayFx {
  if (v === undefined) {
    return { kind: 'none' };
  }
  const o = obj(v, path);
  const kind = oneOf(o.kind, ['none', 'fade', 'pop', 'slide'] as const, `${path}.kind`);
  if (kind === 'none') {
    return { kind };
  }
  const duration = Math.max(0, num(o.duration, `${path}.duration`, 0.3));
  if (kind === 'slide') {
    return {
      kind,
      from: oneOf(o.from, ['left', 'right', 'top', 'bottom'] as const, `${path}.from`, 'bottom'),
      duration,
    };
  }
  return { kind, duration };
}

function boxStyle(v: unknown, path: string): BoxStyle {
  const o = v === undefined ? {} : obj(v, path);
  const size = (x: unknown, p: string): number | 'auto' | 'fill' | undefined =>
    x === undefined ? undefined : x === 'auto' || x === 'fill' ? x : Math.max(0, num(x, p));
  const out: BoxStyle = {};
  if (o.bg !== undefined) {
    out.bg = styleColor(o.bg, `${path}.bg`);
  }
  if (o.opacity !== undefined) {
    out.opacity = Math.min(1, Math.max(0, num(o.opacity, `${path}.opacity`)));
  }
  if (o.padding !== undefined) {
    out.padding = sides(o.padding, `${path}.padding`);
  }
  if (o.margin !== undefined) {
    out.margin = sides(o.margin, `${path}.margin`);
  }
  if (o.border !== undefined && o.border !== null) {
    const b = obj(o.border, `${path}.border`);
    out.border = {
      width: Math.max(0, num(b.width, `${path}.border.width`)),
      color: styleColor(b.color, `${path}.border.color`),
      style: oneOf(b.style, ['solid', 'dashed'] as const, `${path}.border.style`, 'solid'),
    };
  }
  if (o.radius !== undefined) {
    out.radius = Math.max(0, num(o.radius, `${path}.radius`));
  }
  if (o.shadow !== undefined) {
    out.shadow = oneOf(o.shadow, ['none', 'sm', 'md', 'lg'] as const, `${path}.shadow`);
  }
  const w = size(o.width, `${path}.width`);
  const h = size(o.height, `${path}.height`);
  if (w !== undefined) {
    out.width = w;
  }
  if (h !== undefined) {
    out.height = h;
  }
  return out;
}

function textStyle(v: unknown, path: string): TextStyle {
  const o = v === undefined ? {} : obj(v, path);
  const out: TextStyle = {};
  if (o.color !== undefined) {
    out.color = styleColor(o.color, `${path}.color`);
  }
  if (typeof o.size === 'string' && VALUE_REF_RE.test(o.size)) {
    out.size = o.size;
  } else if (o.size !== undefined) {
    out.size = Math.min(400, Math.max(4, num(o.size, `${path}.size`)));
  }
  if (o.weight !== undefined) {
    const w = num(o.weight, `${path}.weight`);
    out.weight = w >= 650 ? 700 : w >= 550 ? 600 : w >= 450 ? 500 : 400;
  }
  if (o.align !== undefined) {
    out.align = oneOf(o.align, ['left', 'center', 'right'] as const, `${path}.align`);
  }
  if (o.font !== undefined) {
    out.font = oneOf(o.font, ['ui', 'mono', 'serif'] as const, `${path}.font`);
  }
  if (o.lineHeight !== undefined) {
    out.lineHeight = Math.min(4, Math.max(0.5, num(o.lineHeight, `${path}.lineHeight`)));
  }
  if (o.maxLines !== undefined) {
    out.maxLines = Math.max(0, Math.round(num(o.maxLines, `${path}.maxLines`)));
  }
  return out;
}

function layout(v: unknown, path: string): FlexLayout {
  const o = v === undefined ? {} : obj(v, path);
  return {
    dir: oneOf(o.dir, ['row', 'col'] as const, `${path}.dir`, 'col'),
    gap: Math.max(0, num(o.gap, `${path}.gap`, 4)),
    align: oneOf(o.align, ['start', 'center', 'end', 'stretch'] as const, `${path}.align`, 'stretch'),
    justify: oneOf(o.justify, ['start', 'center', 'end', 'between'] as const, `${path}.justify`, 'start'),
  };
}

/** One block of a component tree (depth-capped against hostile input). */
export function block(v: unknown, path: string, depth = 0): OverlayBlock {
  if (depth > 16) {
    throw new FieldError(`${path}: blocks nested too deep`);
  }
  const o = obj(v, path);
  const kind = oneOf(o.kind, ['box', 'text', 'image', 'icon', 'divider', 'progress'] as const, `${path}.kind`);
  const bid = id(o.id, `${path}.id`);
  const showIf = o.showIf === undefined ? {} : { showIf: str(o.showIf, `${path}.showIf`) };
  switch (kind) {
    case 'box':
      return {
        kind,
        id: bid,
        style: boxStyle(o.style, `${path}.style`),
        layout: layout(o.layout, `${path}.layout`),
        children: arr(o.children, `${path}.children`, true).map((c, i) =>
          block(c, `${path}.children[${i}]`, depth + 1),
        ),
        ...showIf,
      };
    case 'text':
      return {
        kind,
        id: bid,
        style: textStyle(o.style, `${path}.style`),
        text: str(o.text, `${path}.text`, ''),
        rich: bool(o.rich, `${path}.rich`, false),
        ...showIf,
      };
    case 'image': {
      const src = str(o.src, `${path}.src`, '');
      // a template ({{param}}) or a safe data: URI — never a remote URL
      if (!/^\{\{[\w.]+\}\}$/.test(src) && src !== '' && !isSafeImage(src)) {
        throw new FieldError(`${path}.src: images must be data: URIs or a {{param}}`);
      }
      return {
        kind,
        id: bid,
        style: boxStyle(o.style, `${path}.style`),
        src,
        fit: oneOf(o.fit, ['contain', 'cover'] as const, `${path}.fit`, 'contain'),
        ...showIf,
      };
    }
    case 'icon':
      return {
        kind,
        id: bid,
        style: textStyle(o.style, `${path}.style`),
        icon: str(o.icon, `${path}.icon`, ''),
        ...showIf,
      };
    case 'divider':
      return { kind, id: bid, style: boxStyle(o.style, `${path}.style`), ...showIf };
    case 'progress':
      return {
        kind,
        id: bid,
        style: boxStyle(o.style, `${path}.style`),
        value: str(o.value, `${path}.value`, ''),
        ...showIf,
      };
  }
}

function param(v: unknown, path: string): OverlayParam {
  const o = obj(v, path);
  const key = str(o.key, `${path}.key`);
  if (!/^[A-Za-z_][\w]{0,40}$/.test(key)) {
    throw new FieldError(`${path}.key: invalid parameter key`);
  }
  const label = str(o.label, `${path}.label`, key);
  const type = oneOf(o.type, ['text', 'richText', 'image', 'color', 'number', 'toggle'] as const, `${path}.type`);
  switch (type) {
    case 'text':
    case 'richText':
      return { key, label, type, default: str(o.default, `${path}.default`, '') };
    case 'image':
      return {
        key,
        label,
        type,
        default: o.default === null || o.default === undefined ? null : image(o.default, `${path}.default`),
      };
    case 'color':
      return { key, label, type, default: o.default === undefined ? '#ffffff' : color(o.default, `${path}.default`) };
    case 'number':
      return { key, label, type, default: num(o.default, `${path}.default`, 0) };
    case 'toggle':
      return { key, label, type, default: bool(o.default, `${path}.default`, true) };
  }
}

export function component(v: unknown, path: string): OverlayComponent {
  const o = obj(v, path);
  const size = o.size === undefined ? {} : obj(o.size, `${path}.size`);
  const dim = (x: unknown, p: string): number | 'auto' =>
    x === undefined || x === 'auto' ? 'auto' : Math.max(0, num(x, p));
  const bound = (x: unknown, p: string) =>
    x === undefined ? {} : { [p]: Math.min(4000, Math.max(0, num(x, `${path}.size.${p}`))) };
  return {
    id: id(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`, ''),
    version: Math.max(1, Math.round(num(o.version, `${path}.version`, 1))),
    params: arr(o.params, `${path}.params`, true).map((p, i) => param(p, `${path}.params[${i}]`)),
    root: block(o.root, `${path}.root`),
    size: {
      width: dim(size.width, `${path}.size.width`),
      height: dim(size.height, `${path}.size.height`),
      ...bound(size.minWidth, 'minWidth'),
      ...bound(size.maxWidth, 'maxWidth'),
    },
    designHeight: Math.max(100, num(o.designHeight, `${path}.designHeight`, 1080)),
    ...(o.textScale === undefined ? {} : { textScale: textScale(o.textScale, `${path}.textScale`) }),
  };
}

export function theme(v: unknown, path: string): OverlayTheme {
  const o = obj(v, path);
  const tokens = obj(o.tokens ?? {}, `${path}.tokens`);
  return {
    id: id(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`, ''),
    tokens: Object.fromEntries(
      Object.entries(tokens).map(([k, c]) => {
        if (!/^[A-Za-z][\w-]{0,30}$/.test(k)) {
          throw new FieldError(`${path}.tokens: invalid token name`);
        }
        const s = str(c, `${path}.tokens.${k}`);
        if (!isSafeColor(s) || s.startsWith('$')) {
          throw new FieldError(`${path}.tokens.${k}: not a colour`);
        }
        return [k, s];
      }),
    ),
  };
}

export function anchor(v: unknown, path: string): OverlayAnchor {
  const o = obj(v, path);
  const kind = oneOf(o.kind, ['screen', 'object', 'world'] as const, `${path}.kind`);
  if (kind === 'screen') {
    return { kind, pos: v2(o.pos, `${path}.pos`), pin: oneOf(o.pin, PINS, `${path}.pin`, 'c') };
  }
  const offset = o.offset === undefined ? ([0, -60] satisfies [number, number]) : v2(o.offset, `${path}.offset`);
  const leader = bool(o.leader, `${path}.leader`, true);
  const tint = o.leaderColor === undefined ? {} : { leaderColor: color(o.leaderColor, `${path}.leaderColor`) };
  if (kind === 'object') {
    return { kind, object: id(o.object, `${path}.object`), offset, leader, ...tint };
  }
  return { kind, pos: v3(o.pos, `${path}.pos`), offset, leader, ...tint };
}

export function value(v: unknown, path: string): OverlayValue {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') {
    if (typeof v === 'string' && v.startsWith('data:') && !isSafeImage(v)) {
      throw new FieldError(`${path}: unsafe image value`);
    }
    return v;
  }
  return num(v, path);
}

export function instance(v: unknown, path: string): OverlayInstance {
  const o = obj(v, path);
  const values = o.values === undefined ? {} : obj(o.values, `${path}.values`);
  return {
    id: id(o.id, `${path}.id`),
    component: id(o.component, `${path}.component`),
    componentVersion: Math.max(1, Math.round(num(o.componentVersion, `${path}.componentVersion`, 1))),
    values: Object.fromEntries(Object.entries(values).map(([k, x]) => [k, value(x, `${path}.values.${k}`)])),
    theme: o.theme === null || o.theme === undefined ? null : id(o.theme, `${path}.theme`),
    anchor: anchor(o.anchor, `${path}.anchor`),
    scale: Math.min(10, Math.max(0.1, num(o.scale, `${path}.scale`, 1))),
    ...(o.textScale === undefined ? {} : { textScale: textScale(o.textScale, `${path}.textScale`) }),
  };
}

/** A text-size multiplier (overlay instances, step cards, labels). */
export function textScale(v: unknown, path: string): number {
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, num(v, path)));
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** One overlay component from JSON (the library, an overlay or animation
 *  file): it, or what is wrong and where. */
export function parseOverlayComponent(v: unknown, path: string): { component?: OverlayComponent; error?: string } {
  const r = readField(() => component(v, path));
  return r.value ? { component: r.value } : { error: r.error };
}

/** One overlay theme from JSON: it, or what is wrong and where. */
export function parseOverlayTheme(v: unknown, path: string): { theme?: OverlayTheme; error?: string } {
  const r = readField(() => theme(v, path));
  return r.value ? { theme: r.value } : { error: r.error };
}
