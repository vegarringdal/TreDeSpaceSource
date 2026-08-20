import { RadioGroup } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for RadioGroup. */
export function RadioGroupDemo() {
  const [mode, setMode] = useState('orbit');
  return (
    <Section
      title="RadioGroup"
      note="Mutually exclusive options rendered as square checkboxes — the settings-panel visual language. An option can carry a dim hint or a longer info popover."
      props={['RadioGroupProps', 'RadioOption']}
      code={`function CameraMode() {
  const [mode, setMode] = useState('orbit');
  return (
    <RadioGroup value={mode} onChange={setMode} options={[
      { value: 'orbit', label: 'Orbit', hint: 'default' },
      { value: 'fly', label: 'Fly' },
      { value: 'walk', label: 'Walk', info: 'Gravity and collision.' },
    ]} />
  );
}`}
    >
      <RadioGroup
        value={mode}
        onChange={setMode}
        options={[
          { value: 'orbit', label: 'Orbit', hint: 'default' },
          { value: 'fly', label: 'Fly' },
          { value: 'walk', label: 'Walk', info: 'Walk mode adds gravity and collision against the model.' },
        ]}
      />
    </Section>
  );
}
