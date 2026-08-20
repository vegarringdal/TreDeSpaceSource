import { IconAdjustments, IconEye, IconFocus2, IconPalette, IconRuler } from '@tabler/icons-react';
import { Ribbon, RibbonButton, RibbonNumber, RibbonSection } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for the Ribbon toolbar system. */
export function RibbonDemo() {
  const [tool, setTool] = useState('measure');
  const [snap, setSnap] = useState(5);
  return (
    <Section
      title="Ribbon"
      note="The top toolbar system: Ribbon → titled RibbonSections → items that declare a size (big = 1 per column, medium = 2, mini = 3) and pack into columns in order. RibbonNumber embeds a NumberInput; RibbonSlot is the escape hatch for any content. Give the bar a fixed height (the app uses 124 px)."
      props={['RibbonButtonProps', 'RibbonNumberProps', 'RibbonSize']}
      code={`function Toolbar() {
  const [tool, setTool] = useState('measure');
  const [snap, setSnap] = useState(5);
  return (
    <Ribbon>
      <RibbonSection title="Tools">
        <RibbonButton icon={<IconRuler />} label="Measure"
          selected={tool === 'measure'}
          onClick={() => setTool('measure')} />
      </RibbonSection>
      <RibbonSection title="View">
        <RibbonButton icon={<IconEye />} label="Visibility"
          size="medium" onClick={toggleVisibility} />
        <RibbonNumber label="Snap" unit="mm" size="medium"
          value={snap} onChange={setSnap} />
      </RibbonSection>
    </Ribbon>
  );
}`}
    >
      <div className="h-[124px] overflow-x-auto rounded border border-slate-800 bg-slate-950">
        <Ribbon>
          <RibbonSection title="Tools">
            <RibbonButton
              icon={<IconRuler />}
              label="Measure"
              selected={tool === 'measure'}
              onClick={() => setTool('measure')}
            />
            <RibbonButton
              icon={<IconFocus2 />}
              label="Frame"
              selected={tool === 'frame'}
              onClick={() => setTool('frame')}
            />
          </RibbonSection>
          <RibbonSection title="View">
            <RibbonButton icon={<IconEye />} label="Visibility" size="medium" onClick={() => undefined} />
            <RibbonButton icon={<IconPalette />} label="Colors" size="medium" onClick={() => undefined} />
            <RibbonNumber label="Snap" unit="mm" size="medium" min={0} max={100} value={snap} onChange={setSnap} />
            <RibbonButton icon={<IconAdjustments />} label="Settings" size="medium" onClick={() => undefined} />
          </RibbonSection>
        </Ribbon>
      </div>
    </Section>
  );
}
