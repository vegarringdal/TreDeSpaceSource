import { IconAlertTriangle, IconBolt, IconCheck, IconInfoCircle } from '@tabler/icons-react';
import {
  BorderInput,
  type BorderValue,
  type BoxSides,
  BoxSidesInput,
  IconSelect,
  ImagePicker,
} from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const ICONS = [
  { name: 'info', label: 'Info', node: <IconInfoCircle /> },
  { name: 'warning', label: 'Warning', node: <IconAlertTriangle /> },
  { name: 'check', label: 'Check', node: <IconCheck /> },
  { name: 'bolt', label: 'Bolt', node: <IconBolt /> },
];

/** Gallery section for BoxSidesInput, BorderInput, IconSelect, ImagePicker. */
export function StyleInputsDemo() {
  const [pad, setPad] = useState<BoxSides>([8, 12, 8, 12]);
  const [border, setBorder] = useState<BorderValue | null>({ width: 1, color: '#38bdf8', style: 'solid' });
  const [icon, setIcon] = useState('info');
  const [img, setImg] = useState<string | null>(null);
  return (
    <Section
      title="BoxSidesInput / BorderInput / IconSelect / ImagePicker"
      note="Style fields for a visual editor: four box sides (one linked value or each side), a border (on/off, width 0–40 px, colour, solid/dashed; a colour that is not a hex — a theme token, a {{value}} — shows as text for your own field to change), one icon from a fixed set, and an image picked from disk into a data: URI (never a URL — the value stays self-contained) with a size cap."
      props={[
        'BoxSidesInputProps',
        'BoxSides',
        'BorderInputProps',
        'BorderValue',
        'IconSelectProps',
        'ImagePickerProps',
        'LabelledProps',
      ]}
      code={`const ICONS = [
  { name: 'info', label: 'Info', node: <IconInfoCircle /> },
  { name: 'warning', label: 'Warning', node: <IconAlertTriangle /> },
];

function CardStyle() {
  const [pad, setPad] = useState<BoxSides>([8, 12, 8, 12]);
  const [border, setBorder] = useState<BorderValue | null>(null);
  const [icon, setIcon] = useState('info');
  const [img, setImg] = useState<string | null>(null);
  return (
    <>
      <BoxSidesInput label="Padding" value={pad} onChange={setPad} />
      {/* ticking it starts from 1 px solid; a colour token shows as text */}
      <BorderInput value={border} onChange={setBorder} />
      <IconSelect value={icon} icons={ICONS} onChange={setIcon} />
      <ImagePicker label="Logo" labelPosition="left" labelWidth={48}
        value={img} maxBytes={256 * 1024} onChange={setImg} />
    </>
  );
}`}
    >
      <div className="flex w-80 flex-col gap-2">
        <BoxSidesInput label="Padding" value={pad} onChange={setPad} />
        <BorderInput value={border} onChange={setBorder} />
        <IconSelect value={icon} icons={ICONS} onChange={setIcon} />
        <ImagePicker
          label="Logo"
          labelPosition="left"
          labelWidth={48}
          value={img}
          maxBytes={256 * 1024}
          onChange={setImg}
        />
        <div
          className="flex items-center gap-2 bg-slate-900 text-slate-100"
          style={{
            padding: pad.map((p) => `${p}px`).join(' '),
            border: border ? `${border.width}px ${border.style} ${border.color}` : 'none',
          }}
        >
          {ICONS.find((i) => i.name === icon)?.node}
          {img ? <img src={img} alt="" className="h-6" /> : 'Preview'}
        </div>
      </div>
    </Section>
  );
}
