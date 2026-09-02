import type { SelectOption } from '@treDeSpaceUI/widgets';
import type { ColorMode } from '../../api/tredespace-client';

/** The colour modes sql.color and colorRules.applyList share. `custom-set`
 *  only makes sense where the demo has a config to hand, so the list form
 *  leaves it out. */
export const COLOR_MODE_OPTIONS: SelectOption[] = [
  { value: 'default-white', label: 'default-white (white base + hits)' },
  { value: 'default-hidden', label: 'default-hidden (isolate the hits)' },
  { value: 'default-transparent', label: 'default-transparent (10% white base)' },
  { value: 'default-set', label: 'default-set (over the Set Color rules)' },
  { value: 'custom-color', label: 'custom-color (orange hits, no base)' },
  { value: 'custom-set', label: 'custom-set (own rules + red hits)' },
];

export const LIST_MODE_OPTIONS = COLOR_MODE_OPTIONS.filter((o) => o.value !== 'custom-set');

export type ModeKey = (typeof COLOR_MODE_OPTIONS)[number]['value'];

/** The demo's stand-in for a Set Color config a host would keep on its side. */
export const DEMO_SET_CONFIG = {
  rules: [
    {
      comment: 'host config',
      filters: [{ op: 'append' as const, mode: 'contains' as const, value: '' }],
      color: '#dddddd',
    },
  ],
  mode: 'reset' as const,
};

/** Dropdown choice → the payload mode. */
export function modeFor(key: ModeKey): ColorMode {
  if (key === 'default-transparent') {
    return { type: 'default-transparent', opacity: 0.1 };
  }
  if (key === 'custom-color') {
    return { type: 'custom-color', color: 'orange', base: 'none' };
  }
  if (key === 'custom-set') {
    return { type: 'custom-set', color: 'red', setConfig: DEMO_SET_CONFIG };
  }
  return { type: key === 'default-hidden' || key === 'default-set' ? key : 'default-white' };
}
