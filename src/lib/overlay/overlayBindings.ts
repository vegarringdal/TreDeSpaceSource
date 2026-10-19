// -----------------------------------------------------------------------------
// overlay text templates (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// `{{param}}` placeholders resolved against the instance values, the param
// defaults and the playback context. Pure string work — the renderer escapes
// the result (D13), so nothing here builds markup.

import type { BindingContext, OverlayBlock, OverlayComponent, OverlayParam, OverlayValue } from './overlayTypes';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Context placeholders every component may use, with their labels. */
export const CONTEXT_PLACEHOLDERS: readonly { key: string; label: string }[] = [
  { key: 'step.name', label: 'Step name' },
  { key: 'step.text', label: 'Step text' },
  { key: 'step.index', label: 'Step number (1-based)' },
  { key: 'step.count', label: 'Number of steps' },
  { key: 'object.name', label: 'Attached object' },
  { key: 'time', label: 'Time slider (m:ss)' },
  { key: 'duration', label: 'Scene length (m:ss)' },
];

/** Older placeholder names that still resolve (designs saved before steps
 *  replaced parts). */
const CONTEXT_ALIASES: Readonly<Record<string, string>> = {
  'part.name': 'step.name',
  'part.description': 'step.text',
  'part.index': 'step.index',
  'part.count': 'step.count',
  'actor.name': 'object.name',
};

const CONTEXT_KEYS = new Set([...CONTEXT_PLACEHOLDERS.map((p) => p.key), ...Object.keys(CONTEXT_ALIASES)]);

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** m:ss.s for the {{time}} / {{duration}} placeholders. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** The value a param has for this instance (its own value, else the default). */
export function paramValue(param: OverlayParam, values: Readonly<Record<string, OverlayValue>>): OverlayValue {
  const v = values[param.key];
  return v === undefined ? param.default : v;
}

function contextValue(name: string, ctx: BindingContext): string | null {
  const key = CONTEXT_ALIASES[name] ?? name;
  switch (key) {
    case 'step.name':
      return ctx.step?.name ?? '';
    case 'step.text':
      return ctx.step?.text ?? '';
    case 'step.index':
      return ctx.step ? String(ctx.step.index) : '';
    case 'step.count':
      return ctx.step ? String(ctx.step.count) : '';
    case 'object.name':
      return ctx.objectName ?? '';
    case 'time':
      return formatClock(ctx.time);
    case 'duration':
      return formatClock(ctx.duration);
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** A resolver for one instance: param values first, then the context;
 *  unknown placeholders resolve to ''. */
/** The value an item label's text goes into: `title` when the design has a
 *  text value of that name, else its first text value; null when it has
 *  none (its labels would show no text). */
export function labelTextKey(c: OverlayComponent): string | null {
  const text = c.params.filter((p) => p.type === 'text' || p.type === 'richText');
  return (text.find((p) => p.key === 'title') ?? text[0])?.key ?? null;
}

export function makeResolver(
  component: OverlayComponent,
  values: Readonly<Record<string, OverlayValue>>,
  ctx: BindingContext,
): (key: string) => OverlayValue {
  const params = new Map(component.params.map((p) => [p.key, p]));
  return (key) => {
    const p = params.get(key);
    if (p) {
      return paramValue(p, values);
    }
    return contextValue(key, ctx) ?? '';
  };
}

/** Replace every {{key}} in `text`. A value may itself hold placeholders
 *  ("Step {{step.index}}" typed into a param) — they expand once more, never
 *  recursively. */
export function substitute(text: string, resolve: (key: string) => OverlayValue): string {
  const once = (t: string) =>
    t.replace(PLACEHOLDER_RE, (_, key: string) => {
      const v = resolve(key);
      return v === null || v === undefined ? '' : String(v);
    });
  const first = once(text);
  return first.includes('{{') ? once(first) : first;
}

/** The single param a text is bound to when it is exactly `{{key}}` — what
 *  in-place editing writes back to. */
export function soleParam(text: string): string | null {
  const m = /^\s*\{\{\s*([\w]+)\s*\}\}\s*$/.exec(text);
  return m ? m[1] : null;
}

/** showIf: hidden when the named toggle is false or the named text is empty. */
export function isShown(block: OverlayBlock, resolve: (key: string) => OverlayValue): boolean {
  if (!block.showIf) {
    return true;
  }
  const v = resolve(block.showIf);
  return !(v === false || v === null || v === '' || v === 0);
}

/** Progress 0..1 from a progress block's value: "0.4", "40%", "a/b" (after
 *  substitution — e.g. "{{step.index}}/{{step.count}}"). */
export function progressValue(text: string): number {
  const t = text.trim();
  const frac = /^(-?[\d.]+)\s*\/\s*(-?[\d.]+)$/.exec(t);
  let v = 0;
  if (frac) {
    const d = Number(frac[2]);
    v = d !== 0 ? Number(frac[1]) / d : 0;
  } else if (t.endsWith('%')) {
    v = Number(t.slice(0, -1)) / 100;
  } else {
    v = Number(t);
  }
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Every placeholder a component uses, and whether it resolves to a param
 *  or a context value (unknown ones are flagged in the editor). */
export function listPlaceholders(component: OverlayComponent): { key: string; known: boolean }[] {
  const params = new Set(component.params.map((p) => p.key));
  const found = new Map<string, boolean>();
  const scan = (text: string) => {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      found.set(m[1], params.has(m[1]) || CONTEXT_KEYS.has(m[1]));
    }
  };
  const walk = (b: OverlayBlock) => {
    if (b.showIf) {
      found.set(b.showIf, params.has(b.showIf) || CONTEXT_KEYS.has(b.showIf));
    }
    if (b.kind === 'text') {
      scan(b.text);
    } else if (b.kind === 'image') {
      scan(b.src);
    } else if (b.kind === 'progress') {
      scan(b.value);
    } else if (b.kind === 'box') {
      for (const c of b.children) {
        walk(c);
      }
    }
  };
  walk(component.root);
  return [...found].map(([key, known]) => ({ key, known }));
}
