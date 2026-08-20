import { InfoBox, InfoButton } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

/** Gallery section for InfoBox / InfoButton. */
export function InfoDemo() {
  return (
    <Section
      title="InfoBox / InfoButton"
      note="InfoBox is an always-visible tinted note. InfoButton is its compact replacement: the same note behind a small info icon, one click away instead of taking permanent vertical space."
      props={['InfoBoxProps', 'InfoButtonProps']}
      code={`function PanelHeader() {
  return (
    <>
      <InfoBox>Always-visible hint.</InfoBox>
      <span>
        Section title
        <InfoButton label="About this section">
          Popover note — flips above/below, closes on Escape.
        </InfoButton>
      </span>
    </>
  );
}`}
    >
      <InfoBox>An always-visible hint — use sparingly; prefer InfoButton in tight panels.</InfoBox>
      <div className="mt-3 flex items-center gap-1.5 text-slate-300">
        Section header with an info popover
        <InfoButton label="About this section">
          The popover flips above/below automatically and closes on outside click or Escape.
        </InfoButton>
      </div>
    </Section>
  );
}
