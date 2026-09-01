// The colour MODE a packed result is painted with — shared by `sql.color` and
// `colorRules.applyList`. See EVENTS.md; the modes themselves live with the
// coloring pipeline in sqlReports.actions.
import { normalizeRules } from '../../components/panels/multi-color/multiColor.state';
import type { PackedColorMode } from '../../state/sqlReports/sqlReports.actions';
import { storesState, TEMP_STORE } from '../../state/stores/stores.state';
import { CSS_COLOR_NAMES } from '../color/colorNames';
import { parseColor } from '../color/hexColor';
import { ApiError, isRecord } from './protocol';

const BASES = ['white', 'transparent', 'hidden', 'none'] as const;
type Base = (typeof BASES)[number];

const TYPES = [
  'default-white',
  'default-hidden',
  'default-transparent',
  'default-set',
  'custom-color',
  'custom-set',
] as const;

/** 0-1, or undefined when the field is absent. */
function unit(v: unknown, what: string): number | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new ApiError('bad-payload', `${what} must be a number between 0 and 1`);
  }
  return v;
}

/** A hex code or a CSS colour name (the same table `fullname_color` accepts —
 *  `colors.names` lists them). */
function colorToken(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new ApiError('bad-payload', `${what} must be a colour: '#rrggbb' or a name (see colors.names)`);
  }
  if (parseColor(v) == null) {
    throw new ApiError('bad-payload', `${what}: "${v}" is not a hex colour or a known colour name (see colors.names)`);
  }
  return v;
}

/** A host's Set Color config: the same `rules` shape `colorRules.set` takes,
 *  plus the run mode. Store scopes are checked here — a typo would silently
 *  match nothing. */
function setConfig(v: unknown): { rules: ReturnType<typeof normalizeRules>; mode?: 'reset' | 'append' | 'hide' } {
  if (!isRecord(v)) {
    throw new ApiError('bad-payload', 'setConfig must be an object { rules, mode? }');
  }
  const rules = normalizeRules(v.rules);
  const known = new Set([...storesState.get().stores.map((s) => s.name), TEMP_STORE]);
  for (const r of rules) {
    if (r.store && !known.has(r.store)) {
      throw new ApiError('not-found', `setConfig rule store "${r.store}" is not a known store — see assets.stores`);
    }
  }
  const mode = v.mode;
  if (mode !== undefined && mode !== 'reset' && mode !== 'append' && mode !== 'hide') {
    throw new ApiError('bad-payload', "setConfig.mode must be 'reset', 'append' or 'hide'");
  }
  return { rules, ...(mode ? { mode } : {}) };
}

/** Validate a `mode` payload. Omitted = the plain white base coat. */
export function parseColorMode(v: unknown): PackedColorMode {
  if (v === undefined || v === null) {
    return { type: 'default-white' };
  }
  if (!isRecord(v) || typeof v.type !== 'string') {
    throw new ApiError('bad-payload', `mode must be an object with a type: ${TYPES.join(' | ')}`);
  }
  switch (v.type) {
    case 'default-white':
    case 'default-hidden':
    case 'default-set':
      return { type: v.type };
    case 'default-transparent':
      return {
        type: 'default-transparent',
        ...(unit(v.opacity, 'mode.opacity') !== undefined ? { opacity: unit(v.opacity, 'mode.opacity') } : {}),
      };
    case 'custom-color': {
      const base = v.base === undefined ? undefined : (v.base as Base);
      if (base !== undefined && !BASES.includes(base)) {
        throw new ApiError('bad-payload', `mode.base must be one of: ${BASES.join(' | ')}`);
      }
      return {
        type: 'custom-color',
        color: colorToken(v.color, 'mode.color'),
        opacity: unit(v.opacity, 'mode.opacity'),
        ...(base ? { base } : {}),
        baseOpacity: unit(v.baseOpacity, 'mode.baseOpacity'),
      };
    }
    case 'custom-set':
      return {
        type: 'custom-set',
        ...(v.color === undefined ? {} : { color: colorToken(v.color, 'mode.color') }),
        opacity: unit(v.opacity, 'mode.opacity'),
        setConfig: setConfig(v.setConfig),
      };
    default:
      throw new ApiError('bad-payload', `unknown mode.type "${v.type}" — expected one of: ${TYPES.join(' | ')}`);
  }
}

/** The colour names the viewer understands anywhere a colour token is read
 *  (`fullname_color`, Multi rows, `mode.color`). */
export function colorNameTable(): Record<string, string> {
  return { ...CSS_COLOR_NAMES };
}
