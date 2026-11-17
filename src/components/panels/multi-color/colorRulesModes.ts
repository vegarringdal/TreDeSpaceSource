import type { SelectOption } from '@treDeSpaceUI/widgets';
import type { ColorRulesMode } from './multiColor.state';

/** Set Color's run modes — also the mode of an animation look, which runs
 *  the same rules (there "what is already colored" is the look before). */
export const COLOR_RULES_MODE_OPTIONS: readonly SelectOption<ColorRulesMode>[] = [
  { value: 'reset', label: 'Reset model' },
  { value: 'append', label: 'Append only' },
  { value: 'hide', label: 'Hide model' },
];

export const COLOR_RULES_MODE_TOOLTIP =
  'Reset model — clears every existing color, opacity and hidden override before the rules run (like Alt+R).\n\n' +
  'Append only — layers the rules on top of what is already colored.\n\n' +
  'Hide model — hides EVERYTHING first; the rules unhide and color only what they match.';
