// The Key panel's colour-rules editor (rulesEditor.state.ts): its Set Color
// actions, and the sync that binds it — a picked rules key is edited in
// place (each edit a commit, a burst of typing one undo step); otherwise the
// editor is the next rules key, previewed on the scene (an Append draft on
// top of the rules in force) and dropped like a pose when the time slider
// moves. Installed while authoring.

import { openAnimationPanel } from '../../components/panels/animation/animationPanels';
import { makeMultiColorActions } from '../../components/panels/multi-color/multiColor.actions';
import { type MultiColorState, multiColorState } from '../../components/panels/multi-color/multiColor.state';
import { rulesAt } from '../../lib/animation/rules';
import type { RuleSet } from '../../lib/animation/types';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { animationUiState } from './animationUi.state';
import { activeScene, mapActiveScene } from './docEdit';
import { emptyRulesDraft, rulesEditorState } from './rulesEditor.state';
import { liveTimeNow, setPendingRules } from './runtime';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** {mode, rules} as last loaded into or written from the editor — an
 *  editor change that equals it is the sync's own echo. */
let synced = '';
let offs: (() => void)[] = [];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const setOf = (s: Pick<MultiColorState, 'mode' | 'rules'>): RuleSet => ({ mode: s.mode, rules: s.rules });
const textOf = (s: Pick<MultiColorState, 'mode' | 'rules'>): string => JSON.stringify(setOf(s));

/** The picked colour-rules key's index, or null (the editor is the draft). */
export function editedRulesKey(): number | null {
  const p = animationUiState.get().picked;
  const i = p.kind === 'keys' && p.row === '@rules' ? p.indices[0] : undefined;
  return i !== undefined && activeScene()?.colorRules[i] ? i : null;
}

/** Put a rule set into the editor without echoing it back. */
function load(set: RuleSet): void {
  synced = textOf(set);
  if (textOf(rulesEditorState.get()) !== synced) {
    rulesEditorState.set({ mode: set.mode, rules: structuredClone(set.rules), counts: [], collapsed: [] });
  }
}

/** The editor follows its target: the picked key, or an empty draft when
 *  nothing is previewed. */
function follow(): void {
  const i = editedRulesKey();
  const key = i !== null ? activeScene()?.colorRules[i] : undefined;
  if (key) {
    load(key);
    return;
  }
  if (!animationUiState.get().previewRules) {
    load(setOf(emptyRulesDraft()));
  }
}

/** What the scene shows for a draft: an Append draft on top of the rules in
 *  force at the time slider. */
function previewOf(draft: RuleSet): RuleSet {
  const inForce = draft.mode === 'append' ? rulesAt(activeScene()?.colorRules ?? [], liveTimeNow()) : null;
  return inForce ? { mode: inForce.value.mode, rules: [...inForce.value.rules, ...draft.rules] } : draft;
}

/** An edit in the editor: into the picked key, or previewed as the draft. */
function onEdit(s: MultiColorState): void {
  const text = textOf(s);
  if (text === synced) {
    return;
  }
  synced = text;
  const i = editedRulesKey();
  if (i !== null) {
    animationDocActions.commit(
      (d) =>
        mapActiveScene(d, (sc) => ({
          ...sc,
          colorRules: sc.colorRules.map((k, j) =>
            j === i ? { ...k, mode: s.mode, rules: structuredClone(s.rules) } : k,
          ),
        })),
      `rules-edit:${i}`,
    );
    return;
  }
  setPendingRules(previewOf(setOf(s)));
  animationUiState.set({ previewRules: true, current: '@rules' });
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

const base = makeMultiColorActions(rulesEditorState);

export const rulesEditorActions = {
  ...base,

  /** Edits show at once (a key is edited in place, a draft previewed), so
   *  there is nothing to run into the scene. */
  async run(): Promise<void> {
    await Promise.resolve();
  },

  /** The draft starts from the rules in force at the time slider (a Reset
   *  or Hide key repeating them, to change from here on). */
  copyInForce(): void {
    const inForce = rulesAt(activeScene()?.colorRules ?? [], liveTimeNow());
    const rules = structuredClone(inForce?.value.rules ?? []);
    rulesEditorState.set({ mode: inForce?.value.mode === 'hide' ? 'hide' : 'reset', rules, counts: [], collapsed: [] });
  },

  /** A rule set from elsewhere (Set Color's Run, Load) into the editor: the
   *  picked key takes it, else it becomes the previewed draft. */
  take(set: RuleSet): void {
    rulesEditorState.set({ mode: set.mode, rules: structuredClone(set.rules), counts: [], collapsed: [] });
  },

  /** The Set Color panel's rules into the editor (its Load / Save and big
   *  list are there): the picked key takes them, else the draft. */
  fromSetColor(): void {
    rulesEditorActions.take(setOf(multiColorState.get()));
  },

  /** The editor's rules into the Set Color panel, opened. */
  toSetColor(): void {
    const s = rulesEditorState.get();
    multiColorState.set({ mode: s.mode, rules: structuredClone(s.rules), counts: [], collapsed: [] });
    openAnimationPanel('multiColor');
  },

  /** The editor's rule set (what Key keys). */
  current(): RuleSet {
    return setOf(rulesEditorState.get());
  },

  /** Bind the editor while authoring (on) or let it go (off). */
  install(on: boolean): void {
    for (const off of offs) {
      off();
    }
    offs = [];
    if (!on) {
      load(setOf(emptyRulesDraft()));
      return;
    }
    offs = [
      animationUiState.subscribe(follow),
      animationDocState.subscribe(follow),
      rulesEditorState.subscribe(() => onEdit(rulesEditorState.get())),
    ];
    follow();
  },
};
