import type { MenuEntry } from '@treDeSpaceUI/widgets';
import { quickRulesActions } from '../../../state/animation/quickRules.actions';
import { openAnimationPanel } from '../animation/animationPanels';

/** The Rules split button's menu: quick rules for the selection, the whole
 *  model hidden or back to its own colours — each a colour-rules key at the
 *  time slider — and the way to Set Color. */
export function rulesMenuItems(): MenuEntry[] {
  return [
    {
      id: 'colour',
      label: 'Colour the selection from here',
      tooltip: 'The selected items (any, not only objects) in the key colour, on top of the rules before',
      shortcut: 'animation.rules.selectionColour',
      onSelect: () => void quickRulesActions.fromSelection('color'),
    },
    {
      id: 'transparent',
      label: 'Make the selection transparent from here',
      shortcut: 'animation.rules.selectionTransparent',
      onSelect: () => void quickRulesActions.fromSelection('transparent'),
    },
    {
      id: 'hide',
      label: 'Hide the selection from here',
      shortcut: 'animation.rules.selectionHide',
      onSelect: () => void quickRulesActions.fromSelection('hide'),
    },
    {
      id: 'isolate',
      label: 'Only the selection from here',
      tooltip: 'Everything else hidden from the time slider on',
      shortcut: 'animation.rules.selectionOnly',
      onSelect: () => void quickRulesActions.fromSelection('isolate'),
    },
    { separator: true },
    {
      id: 'hideAll',
      label: 'Hide everything from here',
      tooltip: 'Build up from nothing: objects with a Show key (or later rules) bring items in',
      shortcut: 'animation.rules.hideAll',
      onSelect: quickRulesActions.hideAll,
    },
    {
      id: 'showAll',
      label: "The model's own colours from here",
      tooltip: 'A clean model again from the time slider on',
      shortcut: 'animation.rules.showAll',
      onSelect: quickRulesActions.showAll,
    },
    { separator: true },
    {
      id: 'edit',
      label: 'Edit the rules in force',
      tooltip: 'Pick the colour-rules key in force at the time slider — the Key panel edits it',
      shortcut: 'animation.rules.editInForce',
      onSelect: quickRulesActions.editInForce,
    },
    {
      id: 'open',
      label: 'Open Set Color',
      shortcut: 'animation.rules.open',
      onSelect: () => openAnimationPanel('multiColor'),
    },
  ];
}
