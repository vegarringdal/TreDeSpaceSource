import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { useContext } from 'react';
import { MultiColorCtx, MultiColorProvider } from './multiColorContext';
import { RuleEditor } from './RuleEditor';
import { RuleSetActions } from './RuleSetActions';
import { RulesListHeader } from './RulesListHeader';

export { MultiColorProvider };

/** MultiColor: a sequenced list of filter+color rules applied to the whole
 *  model in order — bulk coloring driven by names / pasted tag lists. */
export function MultiColor() {
  useMinSize(280, 260);
  const { store } = useContext(MultiColorCtx);
  const s = store.use();

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 p-2">
      <RulesListHeader />

      {/* only the RULES scroll — the header and the footer stay visible however many rules */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {s.rules.map((rule, i) => (
          <RuleEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional
            key={i}
            idx={i}
            rule={rule}
            count={s.counts[i] ?? null}
            total={s.rules.length}
            collapsed={s.collapsed[i] === true}
          />
        ))}
      </div>
      <RuleSetActions />
    </PanelBody>
  );
}
