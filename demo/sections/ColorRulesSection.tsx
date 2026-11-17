import { Button, Checkbox, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { ModelResetOptions } from '../../api/tredespace-client';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

const RESET_KINDS: readonly (keyof ModelResetOptions)[] = ['color', 'opacity', 'hidden', 'transform'];

export function ColorRulesSection() {
  const { run, c } = useDemo();
  const [contains, setContains] = useState('PIPE');
  const [kinds, setKinds] = useState<ModelResetOptions>({ color: true, opacity: true, hidden: true, transform: true });

  const demoRule = () => ({
    comment: 'demo rule',
    filters: [{ op: 'append' as const, mode: 'contains' as const, value: contains }],
    color: '#ff2020',
    opacity: 0.6,
  });

  const handleSet = () => {
    const rules = [demoRule()];
    void run('colorRules.set', { rules, run: true }, () => c().colorRulesSet(rules, { run: true }));
  };

  const handleApply = () => {
    const rules = [demoRule()];
    void run('colorRules.apply', { rules }, () => c().colorRulesApply(rules));
  };

  /** Only the ticked kinds go on the wire; with none ticked the payload is
   *  empty, which is what resets all four. */
  const handleReset = () => {
    const payload: ModelResetOptions = Object.fromEntries(RESET_KINDS.filter((k) => kinds[k]).map((k) => [k, true]));
    void run('model.reset', payload, () => c().modelReset(payload));
  };

  const handleAdd = () => {
    const rules = [demoRule()];
    void run('colorRules.add', { rules, run: true }, () => c().colorRulesAdd(rules, { run: true }));
  };

  return (
    <DemoSection title="Color rules">
      <TextInput value={contains} onChange={setContains} />
      <Hint>
        Contains-filter text; painted red at 60% opacity, then run. apply paints WITHOUT touching the Set Color panel —
        the external-tooling form.
      </Hint>
      <Row>
        <Button onClick={handleSet}>colorRules.set + run</Button>
        <Button onClick={handleApply}>colorRules.apply (GUI untouched)</Button>
        <Button onClick={handleAdd}>colorRules.add + run</Button>
        <Button onClick={() => void run('colorRules.run', {}, () => c().colorRulesRun())}>colorRules.run</Button>
        <Button onClick={() => void run('colorRules.clear', {}, () => c().colorRulesClear())}>colorRules.clear</Button>
      </Row>
      <Row>
        <Button onClick={() => void run('colorRules.resetModel', {}, () => c().colorRulesResetModel())}>
          colorRules.resetModel (Alt+R)
        </Button>
      </Row>
      <Hint>
        model.reset clears only the ticked kinds; with none ticked the payload is empty — which resets all four.
      </Hint>
      <Row>
        {RESET_KINDS.map((k) => (
          <Checkbox
            key={k}
            checked={kinds[k] === true}
            onChange={(on) => setKinds((prev) => ({ ...prev, [k]: on }))}
            label={k}
          />
        ))}
        <Button onClick={handleReset}>model.reset</Button>
      </Row>
    </DemoSection>
  );
}
