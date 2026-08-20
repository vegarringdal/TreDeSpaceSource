import { type NavState, navActions } from '../../../../state/viewer/nav.state';

export type SpeedRow = Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  shortcutBase: string;
  onChange: (x: number) => void;
}>;

/** Number-stepper rows for the Navigation tab — one per speed/sensitivity
 *  field of the nav state, in display order. */
export function buildSpeedRows(nav: NavState): SpeedRow[] {
  return [
    {
      label: 'Fly speed',
      value: nav.flySpeed,
      min: 0.5,
      max: 100,
      step: 1,
      unit: 'm/s',
      shortcutBase: 'nav.flySpeed',
      onChange: (x) => navActions.update({ flySpeed: x }),
    },
    {
      label: 'Fly + Shift',
      value: nav.flyShift,
      min: 0.5,
      max: 300,
      step: 1,
      unit: 'm/s',
      shortcutBase: 'nav.flyShift',
      onChange: (x) => navActions.update({ flyShift: x }),
    },
    {
      label: 'Walk speed',
      value: nav.walkSpeed,
      min: 0.5,
      max: 100,
      step: 0.5,
      unit: 'm/s',
      shortcutBase: 'nav.walkSpeed',
      onChange: (x) => navActions.update({ walkSpeed: x }),
    },
    {
      label: 'Walk + Shift',
      value: nav.walkShift,
      min: 0.5,
      max: 300,
      step: 1,
      unit: 'm/s',
      shortcutBase: 'nav.walkShift',
      onChange: (x) => navActions.update({ walkShift: x }),
    },
    {
      label: 'Orbit sensitivity',
      value: nav.orbitSens,
      min: 0.1,
      max: 5,
      step: 0.1,
      unit: '×',
      shortcutBase: 'nav.orbitSens',
      onChange: (x) => navActions.update({ orbitSens: x }),
    },
    {
      label: 'Pan sensitivity (mouse)',
      value: nav.panSens,
      min: 0.1,
      max: 5,
      step: 0.1,
      unit: '×',
      shortcutBase: 'nav.panSens',
      onChange: (x) => navActions.update({ panSens: x }),
    },
    {
      label: 'Pan sensitivity (arrow keys)',
      value: nav.keyPanSens,
      min: 0.1,
      max: 5,
      step: 0.1,
      unit: '×',
      shortcutBase: 'nav.keyPanSens',
      onChange: (x) => navActions.update({ keyPanSens: x }),
    },
  ];
}
