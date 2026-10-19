// -----------------------------------------------------------------------------
// overlay design JSON Schema (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// The card / label designs and themes an animation file (or an overlay file)
// may bring, as JSON Schema `$defs` — handed to an AI assistant in the Claude
// brief so it can check a design it writes. Mirrors overlayParse.ts (the value
// sets come from the same places); `overlayUnknownKeys` reports fields the
// parser would drop, read off these definitions.

import { OVERLAY_ICONS } from './overlayIcons';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Ids of designs, themes and blocks (jsonFields ID_RE). */
const ID_PATTERN = '^[A-Za-z0-9_:.-]{1,64}$';
/** `{{key}}` — a style bound to one of the design's values. */
const VALUE_REF_PATTERN = '^\\{\\{[A-Za-z_]\\w{0,40}\\}\\}$';

const num = (min: number, max: number, description: string): Json => ({
  type: 'number',
  minimum: min,
  maximum: max,
  description,
});
const ref = (name: string): Json => ({ $ref: `#/$defs/${name}` });

const COLOR_FORMS =
  "'#rrggbb' (or #rgb / #rrggbbaa), 'rgb(…)' / 'rgba(…)', 'transparent', a theme colour ('$bg', '$surface', " +
  "'$text', '$muted', '$accent', '$warning', '$danger', '$success'), or '{{key}}' — one of the design's colour values";
const color = (what: string): Json => ({ type: 'string', description: `${what}: ${COLOR_FORMS}` });
const COLOR = color('colour');

const SIDES: Json = {
  type: 'array',
  items: { type: 'number' },
  minItems: 4,
  maxItems: 4,
  description: '[top, right, bottom, left] in px',
};

const BOX_SIZE: Json = {
  anyOf: [{ type: 'number', minimum: 0 }, { enum: ['auto', 'fill'] }],
  description: "px, 'auto' (fits its content) or 'fill' (takes the room left)",
};

const BOX_STYLE: Json = {
  type: 'object',
  additionalProperties: false,
  description: 'Box look (box, image, divider, progress blocks).',
  properties: {
    bg: color('background'),
    opacity: num(0, 1, '0..1'),
    padding: SIDES,
    margin: SIDES,
    border: {
      type: 'object',
      required: ['width', 'color'],
      additionalProperties: false,
      properties: {
        width: num(0, 40, 'px'),
        color: COLOR,
        style: { enum: ['solid', 'dashed'] },
      },
    },
    radius: num(0, 400, 'rounded corners, px'),
    shadow: { enum: ['none', 'sm', 'md', 'lg'] },
    width: BOX_SIZE,
    height: BOX_SIZE,
  },
};

const TEXT_STYLE: Json = {
  type: 'object',
  additionalProperties: false,
  description: 'Text look (text and icon blocks).',
  properties: {
    color: COLOR,
    size: {
      anyOf: [
        { type: 'number', minimum: 4, maximum: 400 },
        { type: 'string', pattern: VALUE_REF_PATTERN },
      ],
      description:
        "font size in px at the design height (default 16; an icon's size, default 20), or '{{key}}' — one of the design's number values",
    },
    weight: { enum: [400, 500, 600, 700] },
    align: { enum: ['left', 'center', 'right'] },
    font: { enum: ['ui', 'mono', 'serif'], description: 'system sans-serif / monospace / serif' },
    lineHeight: num(0.5, 4, '× font size (default 1.3)'),
    maxLines: { type: 'integer', minimum: 0, description: 'cut after this many lines (0 = no limit)' },
  },
};

const LAYOUT: Json = {
  type: 'object',
  additionalProperties: false,
  description: 'How a box lays out its children (flex). Defaults: col, gap 4, align stretch, justify start.',
  properties: {
    dir: { enum: ['row', 'col'] },
    gap: { type: 'number', minimum: 0 },
    align: { enum: ['start', 'center', 'end', 'stretch'] },
    justify: { enum: ['start', 'center', 'end', 'between'] },
  },
};

const SHOW_IF: Json = {
  type: 'string',
  description: "a value key (or 'step.text'): the block hides when that toggle is off or that text is empty",
};

/** One block kind: its own fields plus id / style / showIf. */
function blockKind(
  kind: string,
  style: 'boxStyle' | 'textStyle',
  fields: Record<string, Json>,
  required: string[] = [],
): Json {
  return {
    type: 'object',
    required: ['kind', 'id', ...required],
    additionalProperties: false,
    properties: {
      kind: { const: kind },
      id: { type: 'string', pattern: ID_PATTERN, description: 'unique inside the design' },
      style: ref(style),
      showIf: SHOW_IF,
      ...fields,
    },
  };
}

const BLOCK: Json = {
  oneOf: [
    blockKind('box', 'boxStyle', {
      layout: ref('layout'),
      children: { type: 'array', items: ref('block') },
    }),
    blockKind(
      'text',
      'textStyle',
      {
        text: {
          type: 'string',
          description:
            "the text; '{{key}}' puts a value in, '{{step.name}}' / '{{step.text}}' / '{{step.index}}' / '{{step.count}}' / '{{object.name}}' / '{{time}}' / '{{duration}}' what is playing",
        },
        rich: { type: 'boolean', description: '**bold** and line breaks' },
      },
      ['text'],
    ),
    blockKind('image', 'boxStyle', {
      src: {
        type: 'string',
        description: "'{{key}}' of an image value, or a data:image/(png|jpeg|webp|svg+xml) URI (≤ 1 MB)",
      },
      fit: { enum: ['contain', 'cover'] },
    }),
    blockKind('icon', 'textStyle', {
      icon: {
        enum: OVERLAY_ICONS.map((i) => i.name),
        description: 'one of the built-in icons (size and colour from the style)',
      },
    }),
    blockKind('divider', 'boxStyle', {}),
    blockKind('progress', 'boxStyle', {
      value: {
        type: 'string',
        description: "how full: 'a/b' ('{{step.index}}/{{step.count}}'), 'n%' or 0..1 — values may be '{{key}}'",
      },
    }),
  ],
};

const PARAM: Json = {
  type: 'object',
  required: ['key', 'type'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: '^[A-Za-z_]\\w{0,40}$', description: 'used as {{key}}' },
    label: { type: 'string', description: 'its name in the app' },
    type: { enum: ['text', 'richText', 'image', 'color', 'number', 'toggle'] },
    default: { description: 'text: string; image: data: URI or null; color: colour; number: number; toggle: boolean' },
  },
};

const COMPONENT: Json = {
  type: 'object',
  required: ['id', 'root'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: ID_PATTERN, description: "your own id, e.g. 'custom.stepCard' — never 'preset.…'" },
    name: { type: 'string', description: 'its name in the app' },
    version: { type: 'integer', minimum: 1 },
    params: { type: 'array', items: ref('param'), description: 'the values each card sets' },
    root: ref('block'),
    size: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: {
          anyOf: [{ type: 'number', minimum: 0 }, { const: 'auto' }],
          description: "px, or 'auto' (as wide as its text, between minWidth and maxWidth)",
        },
        height: { anyOf: [{ type: 'number', minimum: 0 }, { const: 'auto' }] },
        minWidth: num(0, 4000, 'auto width: at least this (px)'),
        maxWidth: num(0, 4000, 'auto width: wraps at this (px, default 640)'),
      },
    },
    designHeight: {
      type: 'number',
      minimum: 100,
      description: 'px sizes are for a view this tall (default 1080); they scale with the view',
    },
    textScale: num(0.25, 4, 'every text size × this (default 1)'),
  },
};

const THEME: Json = {
  type: 'object',
  required: ['id', 'tokens'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      pattern: ID_PATTERN,
      description: "your own id, e.g. 'custom.brand' — not 'theme.default' / 'theme.light'",
    },
    name: { type: 'string' },
    tokens: {
      type: 'object',
      propertyNames: { pattern: '^[A-Za-z][\\w-]{0,30}$' },
      additionalProperties: { type: 'string', description: "'#rrggbb' or 'rgb(…)'" },
      description:
        'bg, surface, text, muted, accent, warning, danger, success (and any of your own) — the $token colours',
    },
  },
};

/** `$defs` of the design schema (referenced as #/$defs/component, …/theme). */
export const OVERLAY_SCHEMA_DEFS: Record<string, Json> = {
  component: COMPONENT,
  theme: THEME,
  param: PARAM,
  block: BLOCK,
  boxStyle: BOX_STYLE,
  textStyle: TEXT_STYLE,
  layout: LAYOUT,
};

// -----------------------------------------------------------------------------
// unknown fields
// -----------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const keysOf = (schema: Json): Set<string> =>
  new Set(isObject(schema) && isObject(schema.properties) ? Object.keys(schema.properties) : []);

const BLOCK_KEYS = new Map<string, Set<string>>(
  (isObject(BLOCK) && Array.isArray(BLOCK.oneOf) ? BLOCK.oneOf : []).flatMap((k) => {
    const kind = isObject(k) && isObject(k.properties) && isObject(k.properties.kind) ? k.properties.kind.const : null;
    return typeof kind === 'string' ? [[kind, keysOf(k)] as const] : [];
  }),
);
const TEXT_KINDS = new Set(['text', 'icon']);
const BORDER_KEYS = new Set(['width', 'color', 'style']);
const SIZE_KEYS: ReadonlySet<string> =
  isObject(COMPONENT) && isObject(COMPONENT.properties) ? keysOf(COMPONENT.properties.size) : new Set<string>();

/** Fields of the designs and themes in a file that the parser drops. */
export function overlayUnknownKeys(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const check = (o: unknown, allowed: ReadonlySet<string>, path: string) => {
    if (isObject(o)) {
      for (const k of Object.keys(o)) {
        if (!allowed.has(k)) {
          out.push(`${path}.${k}: not a design field — ignored`);
        }
      }
    }
  };
  const block = (b: unknown, path: string, depth: number) => {
    if (!isObject(b) || depth > 16) {
      return;
    }
    const kind = typeof b.kind === 'string' ? b.kind : '';
    check(b, BLOCK_KEYS.get(kind) ?? new Set(), path);
    check(b.style, keysOf(TEXT_KINDS.has(kind) ? TEXT_STYLE : BOX_STYLE), `${path}.style`);
    if (isObject(b.style)) {
      check(b.style.border, BORDER_KEYS, `${path}.style.border`);
    }
    check(b.layout, keysOf(LAYOUT), `${path}.layout`);
    if (Array.isArray(b.children)) {
      b.children.forEach((c, i) => {
        block(c, `${path}.children[${i}]`, depth + 1);
      });
    }
  };
  (Array.isArray(data.components) ? data.components : []).forEach((c, i) => {
    const path = `components[${i}]`;
    check(c, keysOf(COMPONENT), path);
    if (!isObject(c)) {
      return;
    }
    check(c.size, SIZE_KEYS, `${path}.size`);
    (Array.isArray(c.params) ? c.params : []).forEach((p, k) => {
      check(p, keysOf(PARAM), `${path}.params[${k}]`);
    });
    block(c.root, `${path}.root`, 0);
  });
  (Array.isArray(data.themes) ? data.themes : []).forEach((t, i) => {
    check(t, keysOf(THEME), `themes[${i}]`);
  });
  return out;
}
