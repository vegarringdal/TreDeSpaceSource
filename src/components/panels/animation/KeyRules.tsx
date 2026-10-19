import { IconArrowBarToDown, IconCopy, IconPalette, IconTrash } from '@tabler/icons-react';
import { Button, SegmentedControl, TimeInput } from '@treDeSpaceUI/widgets';
import type { RulesMode, Scene } from '../../../lib/animation/types';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { keysActions } from '../../../state/animation/keys.actions';
import { rulesEditorActions } from '../../../state/animation/rulesEditor.actions';
import { rulesEditorState } from '../../../state/animation/rulesEditor.state';
import { InspectorFrame } from './InspectorFrame';
import { KeyRulesEditor } from './KeyRulesEditor';

const LABEL_W = 56;

const MODES = [
  {
    value: 'reset',
    label: 'Reset',
    tooltip: 'A clean model first, then these rules',
    shortcut: 'animation.rules.mode.reset',
  },
  { value: 'append', label: 'Append', tooltip: 'On top of the rules before', shortcut: 'animation.rules.mode.append' },
  {
    value: 'hide',
    label: 'Hide',
    tooltip: 'Everything hidden; the rules show what they match',
    shortcut: 'animation.rules.mode.hide',
  },
] as const;

/** The Colour rules row or one of its keys: the Set Color rules from a time
 *  on (instant), edited right here — the picked key in place, or the next
 *  rules key, previewed until Key keys it. */
export function KeyRules({ scene, index }: { scene: Scene; index: number | null }) {
  const preview = animationUiState.useSelect((s) => s.previewRules);
  const mode = rulesEditorState.useSelect((s) => s.mode);
  const key = index !== null ? scene.colorRules[index] : undefined;
  const n = scene.colorRules.length;

  const keyButton = (
    <Button
      size="sm"
      icon={<IconPalette />}
      tooltip="These rules as a key at the time slider"
      shortcut="animation.rulesKey"
      onClick={() => keysActions.keyRules()}
    >
      Key rules
    </Button>
  );

  return (
    <InspectorFrame
      kind={key ? 'Colour rules key' : 'Next rules key'}
      name={key ? `${key.t.toFixed(2)} s` : `${n} key${n === 1 ? '' : 's'}`}
      actions={keyButton}
    >
      {key && index !== null && (
        <div className="flex items-center gap-1">
          <TimeInput
            className="min-w-0 flex-1"
            label="Time"
            tooltip="This key's time (s) — the rules apply from here on"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={key.t}
            onChange={(t) => keysActions.setTime('@rules', index, t)}
          />
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            icon={<IconTrash />}
            tooltip="Delete this key"
            shortcut="animation.deleteKey"
            onClick={() => keysActions.deleteKeys('@rules', [index])}
          />
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
          Mode
        </span>
        <SegmentedControl
          size="sm"
          grow
          value={mode}
          options={MODES}
          onChange={(m: RulesMode) => rulesEditorActions.setMode(m)}
        />
      </div>
      <KeyRulesEditor />
      {!key && preview && (
        <span className="text-[11px] text-amber-300">Shown — not keyed yet. Moving the time slider drops it.</span>
      )}
      <span className="text-[11px] text-slate-400">
        {key
          ? 'Changes show at once. The rules apply from this key on, until the next rules key.'
          : 'The next rules key: add rules, see them on the scene, then Key rules — they apply from the time slider on. Objects’ own keys (hide, show, colour) win over the rules.'}
      </span>
      <div className="flex flex-wrap gap-1">
        {!key && (
          <Button
            size="sm"
            icon={<IconCopy />}
            tooltip="Start from the rules in force at the time slider, to change them from here on"
            shortcut="animation.rules.copyInForce"
            onClick={rulesEditorActions.copyInForce}
          >
            Rules in force
          </Button>
        )}
        <Button
          size="sm"
          icon={<IconArrowBarToDown />}
          tooltip={
            key
              ? "This key takes the Set Color panel's rules (its Load / Save and big list are there)"
              : "The Set Color panel's rules as the next rules key"
          }
          shortcut="animation.rules.update"
          onClick={rulesEditorActions.fromSetColor}
        >
          From Set Color
        </Button>
      </div>
    </InspectorFrame>
  );
}
