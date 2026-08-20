import { Button, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

export function ColorRulesSection() {
  const { run, c } = useDemo();
  const [contains, setContains] = useState('PIPE');

  const demoRule = () => ({
    comment: 'demo rule',
    filters: [{ op: 'append' as const, mode: 'contains' as const, value: contains }],
    color: '#ff2020',
    opacity: 60,
  });

  const handleSet = () => {
    const rules = [demoRule()];
    void run('colorRules.set', { rules, run: true }, () => c().colorRulesSet(rules, { run: true }));
  };

  const handleAdd = () => {
    const rules = [demoRule()];
    void run('colorRules.add', { rules, run: true }, () => c().colorRulesAdd(rules, { run: true }));
  };

  return (
    <DemoSection title="Color rules">
      <TextInput value={contains} onChange={setContains} />
      <Hint>Contains-filter text; painted red at 60% opacity, then run.</Hint>
      <Row>
        <Button onClick={handleSet}>colorRules.set + run</Button>
        <Button onClick={handleAdd}>colorRules.add + run</Button>
        <Button onClick={() => void run('colorRules.run', {}, () => c().colorRulesRun())}>colorRules.run</Button>
        <Button onClick={() => void run('colorRules.clear', {}, () => c().colorRulesClear())}>colorRules.clear</Button>
      </Row>
      <Row>
        <Button onClick={() => void run('colorRules.resetModel', {}, () => c().colorRulesResetModel())}>
          colorRules.resetModel (Alt+R)
        </Button>
      </Row>
    </DemoSection>
  );
}
