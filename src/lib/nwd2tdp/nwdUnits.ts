// The unit of an NWD's coordinates, as the Import NWD section offers it.
// Pure data — shared by the import options, the worker and the tests.

/** What the model's numbers are in: `auto` lets the converter decide (feet
 *  for a Revit export, metres otherwise), `asis` takes them as metres. */
export type NwdUnits = 'auto' | 'asis' | 'ft' | 'in' | 'mm' | 'cm';

/** The choices in the order the picker (and its hotkey) steps through. */
export const NWD_UNITS: readonly { readonly value: NwdUnits; readonly label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'asis', label: 'Metres (as stored)' },
  { value: 'ft', label: 'Feet' },
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimetres' },
  { value: 'cm', label: 'Centimetres' },
];

/** Model units → metres; 0 tells the converter to decide by itself. */
const SCALE: Readonly<Record<NwdUnits, number>> = {
  auto: 0,
  asis: 1,
  ft: 0.3048,
  in: 0.0254,
  mm: 0.001,
  cm: 0.01,
};

/** The converter's `unit_scale` for a choice (0 = automatic). */
export function nwdUnitScale(units: NwdUnits): number {
  return SCALE[units];
}

/** The choice after `units` in the picker's order, wrapping. */
export function nextNwdUnits(units: NwdUnits): NwdUnits {
  const at = NWD_UNITS.findIndex((u) => u.value === units);
  return NWD_UNITS[(at + 1) % NWD_UNITS.length].value;
}
