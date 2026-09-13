// The Button look, shared with SegmentedControl so a run of segments and a
// stand-alone button are the same height and weight.

/** Height/padding scale. `md` (24px) lines up with the inputs. */
export type ButtonSize = 'xs' | 'sm' | 'md';

/** Emphasis. `primary` is the confirming action of a dialog or form, `danger`
 *  a destructive one, `ghost` a borderless action inside dense chrome. */
export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

// Square by design — the whole app avoids rounded corners for one visual
// language. Matches the .btn / NumberInput stepper palette.
export const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 border text-xs leading-none transition-colors';

export const BUTTON_SIZE: Readonly<Record<ButtonSize, string>> = {
  xs: 'h-4 px-1 text-[10px]',
  sm: 'h-5 px-2 text-[11px]',
  md: 'h-6 px-2',
};

export const BUTTON_ICON_SIZE: Readonly<Record<ButtonSize, string>> = {
  xs: 'h-4 w-4 p-0',
  sm: 'h-5 w-5 p-0',
  md: 'h-6 w-6 p-0',
};

/** Height floor a wrapping button keeps once its label runs to two lines. */
export const BUTTON_MIN_H: Readonly<Record<ButtonSize, string>> = {
  xs: 'min-h-4',
  sm: 'min-h-5',
  md: 'min-h-6',
};

export const BUTTON_VARIANT: Readonly<Record<ButtonVariant, string>> = {
  default:
    'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600 hover:bg-slate-700 hover:text-slate-100',
  primary: 'border-blue-400 bg-blue-950 text-blue-100 hover:bg-blue-900',
  danger: 'border-red-800 bg-red-950 text-red-200 hover:border-red-600 hover:bg-red-900 hover:text-red-100',
  ghost: 'border-transparent bg-transparent text-slate-300 hover:bg-slate-800 hover:text-slate-100',
};

/** The `active` look wins over the variant — it is a state, not an emphasis. */
export const BUTTON_ACTIVE = 'border-blue-400 bg-blue-950 text-blue-100 hover:border-blue-300';
