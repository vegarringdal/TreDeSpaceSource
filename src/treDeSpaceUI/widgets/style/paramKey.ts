/** `base` as a parameter key — anything but letters, digits and `_` becomes
 *  `_` (nothing left → "param") — numbered past the keys in `taken` it would
 *  clash with ("a b" next to "a_b" → "a_b2"). */
export function uniqueParamKey(base: string, taken: readonly string[]): string {
  const clean = base.replace(/[^\w]/g, '_') || 'param';
  let key = clean;
  for (let n = 2; taken.includes(key); n++) {
    key = `${clean}${n}`;
  }
  return key;
}
