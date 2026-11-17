import { IconPlus } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { rulesEditorActions } from '../../../state/animation/rulesEditor.actions';
import { rulesEditorState } from '../../../state/animation/rulesEditor.state';
import { MultiColorProvider } from '../multi-color/MultiColor';
import { RuleEditor } from '../multi-color/RuleEditor';

const BOUND = { store: rulesEditorState, act: rulesEditorActions };

/** The Set Color rule editor inside the Key panel, bound to the picked
 *  colour-rules key or the next one — every edit shows on the scene. */
export function KeyRulesEditor() {
  const s = rulesEditorState.use();

  return (
    <MultiColorProvider value={BOUND}>
      <div className="flex flex-col gap-1.5">
        {s.rules.length === 0 && (
          <span className="text-[11px] text-slate-500">
            {s.mode === 'hide' ? 'No rules — everything is hidden.' : 'No rules yet.'}
          </span>
        )}
        {s.rules.map((rule, i) => (
          <RuleEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional
            key={i}
            idx={i}
            rule={rule}
            count={null}
            total={s.rules.length}
            collapsed={s.collapsed[i] === true}
          />
        ))}
        <Button
          size="sm"
          icon={<IconPlus />}
          tooltip="A new rule at the end: filters find the items by name, then a colour, an opacity, or hidden (opacity 0)"
          shortcut="animation.rules.addRule"
          onClick={rulesEditorActions.addRule}
        >
          Rule
        </Button>
      </div>
    </MultiColorProvider>
  );
}
