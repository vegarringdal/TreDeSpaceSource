import { interpEase } from './interp';
import type { Interp } from './types';

/** The interpolations with their curves, for EasingSelect (key fields):
 *  smooth eases in and out of the key, linear keeps an even speed, hold
 *  stays and jumps at the key. */
export const INTERP_OPTIONS: readonly {
  value: Interp;
  label: string;
  curve: (u: number) => number;
  shortcut: string;
}[] = [
  { value: 'smooth', label: 'Smooth', curve: (u) => interpEase('smooth', u), shortcut: 'animation.interp.smooth' },
  { value: 'linear', label: 'Linear', curve: (u) => interpEase('linear', u), shortcut: 'animation.interp.linear' },
  { value: 'hold', label: 'Hold', curve: (u) => interpEase('hold', u), shortcut: 'animation.interp.hold' },
];
