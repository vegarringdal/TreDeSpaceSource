// -----------------------------------------------------------------------------
// colour rules over time (DESIGN.md › Animation › Evaluation)
// -----------------------------------------------------------------------------
// The scene's Colour rules row: each key's Set Color rules apply from its
// time on, instantly. An Append key goes on top of the rules before it (its
// rules after theirs, in their mode — Set Color rules apply in order); a
// chain of Append keys keeps building. Before the first key the scene shows
// its own colours. Pure.

import { keyIndexAt } from './interp';
import type { RuleSet, RulesKey } from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** The rules in force and a stable key for them (the worker caches by it). */
export interface RulesFrame {
  key: string;
  value: RuleSet;
}

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** composed frames per keys array (immutable per doc revision), so a frame
 *  hands back the same objects while the rules do not change */
const composedCache = new WeakMap<readonly RulesKey[], RulesFrame[]>();

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Every key's rules as they apply (Append keys composed), in key order. */
export function composedRules(keys: readonly RulesKey[]): readonly RulesFrame[] {
  let out = composedCache.get(keys);
  if (out) {
    return out;
  }
  out = [];
  for (const [i, k] of keys.entries()) {
    const prev = out[out.length - 1];
    out.push(
      k.mode === 'append' && prev
        ? { key: `${prev.key}+${i}`, value: { mode: prev.value.mode, rules: [...prev.value.rules, ...k.rules] } }
        : { key: String(i), value: { mode: k.mode, rules: k.rules } },
    );
  }
  composedCache.set(keys, out);
  return out;
}

/** The rules in force at T; null before the first key. */
export function rulesAt(keys: readonly RulesKey[], T: number): RulesFrame | null {
  const i = keyIndexAt(keys, T);
  return i < 0 ? null : (composedRules(keys)[i] ?? null);
}
