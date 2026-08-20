import { Button } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

/** Gallery section for the attribute-driven tooltips. */
export function TooltipDemo() {
  return (
    <Section
      title="Tooltips"
      note={
        <>
          Attribute-driven: put <code className="text-slate-300">data-tooltip</code> on any element — no wrapper
          component, works in React and plain DOM alike. One document-level listener drives everything; call{' '}
          <code className="text-slate-300">initTooltips()</code> once at startup (this page does). Elements with{' '}
          <code className="text-slate-300">data-shortcut</code> get a combo footer from the hotkeys registry.
        </>
      }
      code={`initTooltips(); // once, at startup — returns a disposer

function Hints() {
  return (
    <>
      <span data-tooltip="Any element works">hover me</span>
      <Button tooltip={'Multi-line\\ntooltips too'}>Button prop</Button>
    </>
  );
}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="cursor-help border-slate-600 border-b border-dashed" data-tooltip="Any element works">
          hover me
        </span>
        <Button tooltip={'Buttons take a tooltip prop.\nMulti-line via \\n.'}>Button prop</Button>
      </div>
    </Section>
  );
}
