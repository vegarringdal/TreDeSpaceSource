// Quick colour-rules keys (DESIGN.md › Animation › Authoring): Set Color
// rules made from the selection, keyed at the time slider without building
// them by hand — colour, hide or isolate the selected items (any items, not
// only objects), hide everything, or back to the model's own colours. They
// are ordinary colour-rules keys: the Key panel edits them, and an Append key
// builds on the rules before it.

import { toast } from '@treDeSpaceUI/widgets';
import { openAnimationPanel } from '../../components/panels/animation/animationPanels';
import { keyIndexAt } from '../../lib/animation/interp';
import { upsertKey } from '../../lib/animation/keyRows';
import type { LookRule, RulesKey, RulesMode } from '../../lib/animation/types';
import { db } from '../viewer/db';
import { animationDocActions } from './animationDoc.actions';
import { animationUiState } from './animationUi.state';
import { activeScene, mapActiveScene } from './docEdit';
import { keysActions } from './keys.actions';
import { liveTimeNow } from './runtime';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** What a quick rule does with the selection. */
export type SelectionRule = 'color' | 'hide' | 'isolate' | 'transparent';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Opacity of "transparent from here". */
export const QUICK_TRANSPARENT = 0.35;

const COMMENTS: Readonly<Record<SelectionRule, string>> = {
  color: 'Coloured from here',
  hide: 'Hidden from here',
  isolate: 'Only these from here',
  transparent: 'Transparent from here',
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** A rule matching exactly these nodes (and what is under them). */
function ruleFor(names: readonly string[], kind: SelectionRule, color: string): LookRule {
  return {
    comment: COMMENTS[kind],
    enabled: true,
    filters: [{ op: 'append', mode: 'multi', value: names.join('\n'), comment: '', level: 0 }],
    color: kind === 'color' ? color : null,
    opacity: kind === 'hide' ? 0 : kind === 'transparent' ? QUICK_TRANSPARENT : 1,
    store: '',
  };
}

function keyRules(mode: RulesMode, rules: LookRule[]): void {
  const key: RulesKey = { t: liveTimeNow(), mode, rules };
  animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, colorRules: upsertKey(s.colorRules, key) })));
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const quickRulesActions = {
  /** A rules key at the time slider doing `kind` to the selected items —
   *  on top of the rules before (isolate starts from a hidden model). */
  async fromSelection(kind: SelectionRule): Promise<void> {
    const sel = await db.animActorFromSelection();
    if (!sel) {
      toast.info('Select the items first (in the 3D view or the Hierarchy).');
      return;
    }
    const rule = ruleFor(sel.fullnames, kind, animationUiState.get().keyColor);
    keyRules(kind === 'isolate' ? 'hide' : 'append', [rule]);
  },

  /** Everything hidden from the time slider on — build up from nothing (an
   *  object's Show key or a later rule brings items in). */
  hideAll(): void {
    keyRules('hide', []);
  },

  /** The model's own colours again from the time slider on. */
  showAll(): void {
    keyRules('reset', []);
  },

  /** The rules key in force at the time slider, picked: the Key panel
   *  edits it. */
  editInForce(): void {
    const keys = activeScene()?.colorRules ?? [];
    const i = keyIndexAt(keys, liveTimeNow());
    if (i < 0) {
      toast.info('No colour rules are in force at the time slider.');
      return;
    }
    keysActions.pickKeys('@rules', [i]);
    openAnimationPanel('animation');
  },
};
