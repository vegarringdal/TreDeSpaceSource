import { IconTrash } from '@tabler/icons-react';
import { Button, InlinePanel } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

/** Gallery section for InlinePanel. */
export function InlinePanelDemo() {
  return (
    <Section
      title="InlinePanel"
      note="A collapsible section for stacking inside panels — the inline cousin of a dock panel, with an actions slot at the right end of the header. Pass open/onToggle to control it; defaultOpen for uncontrolled. The header text is uppercased by default: titleUppercase={false} shows it as written, titleClassName restyles it, and a node as title takes over completely."
      props={['InlinePanelProps']}
      code={`function MeshSection() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <InlinePanel title="Mesh" open={open} onToggle={setOpen}
        actions={<Button iconOnly icon={<IconTrash />} tooltip="Clear" />}>
        <MeshFields />
      </InlinePanel>
      <InlinePanel title="Pump P-101" titleUppercase={false} titleClassName="text-sm">
        <PumpFields />
      </InlinePanel>
    </>
  );
}`}
    >
      <InlinePanel title="Mesh" actions={<Button iconOnly icon={<IconTrash />} tooltip="Clear (demo)" />}>
        <p className="m-0 py-1 text-slate-400">Body content. The header's action button is a separate click target.</p>
      </InlinePanel>
      <InlinePanel className="mt-2" title="Details" defaultOpen={false}>
        <p className="m-0 py-1 text-slate-400">Collapsed by default — expand me.</p>
      </InlinePanel>
      <InlinePanel className="mt-2" title="Pump P-101" titleUppercase={false} titleClassName="text-sm">
        <p className="m-0 py-1 text-slate-400">
          titleUppercase={'{false}'} keeps the title as written; titleClassName restyles the header text.
        </p>
      </InlinePanel>
    </Section>
  );
}
