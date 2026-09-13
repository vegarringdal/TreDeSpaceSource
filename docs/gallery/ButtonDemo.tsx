import { IconFocus2, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for Button. */
export function ButtonDemo() {
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);

  const run = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1500);
  };

  return (
    <Section
      title="Button"
      note="The app's button: 24 px tall (size md) so it lines up with the inputs. `variant` sets the emphasis — primary for the confirming action, danger for a destructive one, ghost for dense chrome — while `active` is a state and wins over it. `wrap` lets a long label take a second line, `grow` splits a row, `loading` swaps the icon for a spinner, and read-only mode renders a non-interactive chip in the same box."
      props={['ButtonProps', 'ButtonVariant', 'ButtonSize']}
      code={`function Actions() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center gap-1.5">
      <Button icon={<IconFocus2 />} onClick={frameSelection}>Frame</Button>
      <Button variant="primary" onClick={save}>Save</Button>
      <Button variant="danger" icon={<IconTrash />} onClick={remove}>Delete</Button>
      <Button active={on} onClick={() => setOn(!on)}>Toggle</Button>
      <Button loading={busy} onClick={run}>Run</Button>
      <Button readOnly>Ctrl+F</Button>
    </div>
  );
}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button icon={<IconFocus2 />} onClick={() => undefined}>
            Frame
          </Button>
          <Button variant="primary">Save</Button>
          <Button variant="danger" icon={<IconTrash />}>
            Delete
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button active={active} onClick={() => setActive((v) => !v)}>
            {active ? 'Active' : 'Inactive'}
          </Button>
          <Button disabled>Disabled</Button>
          <Button iconOnly icon={<IconTrash />} tooltip="Delete (icon-only)" />
          <Button readOnly>Ctrl+F</Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button size="md">md</Button>
          <Button size="xs" iconOnly icon={<IconTrash />} tooltip="xs icon" />
          <Button size="sm" iconOnly icon={<IconTrash />} tooltip="sm icon" />
          <Button badge={12}>With badge</Button>
          <Button loading={loading} onClick={run}>
            {loading ? 'Running…' : 'Run (1.5 s)'}
          </Button>
        </div>

        <div className="flex w-64 gap-1.5">
          <Button wrap grow>
            A long label that wraps
          </Button>
          <Button wrap grow>
            Deselect all
          </Button>
        </div>
      </div>
    </Section>
  );
}
