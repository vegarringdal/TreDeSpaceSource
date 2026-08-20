import { IconFocus2, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for Button. */
export function ButtonDemo() {
  const [active, setActive] = useState(true);
  return (
    <Section
      title="Button"
      note="The app's button: 24 px tall so it lines up with the inputs. Read-only mode renders a non-interactive chip in the same box, for values displayed next to real buttons."
      props={['ButtonProps']}
      code={`function Actions() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center gap-1.5">
      <Button icon={<IconFocus2 />} onClick={frameSelection}>Frame</Button>
      <Button active={on} onClick={() => setOn(!on)}>Toggle</Button>
      <Button disabled>Disabled</Button>
      <Button iconOnly icon={<IconTrash />} tooltip="Delete" />
      <Button readOnly>Ctrl+F</Button>
    </div>
  );
}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button icon={<IconFocus2 />} onClick={() => undefined}>
          Frame
        </Button>
        <Button active={active} onClick={() => setActive((v) => !v)}>
          {active ? 'Active' : 'Inactive'}
        </Button>
        <Button disabled>Disabled</Button>
        <Button iconOnly icon={<IconTrash />} tooltip="Delete (icon-only)" />
        <Button readOnly>Ctrl+F</Button>
      </div>
    </Section>
  );
}
