import { ColorSelect, Select } from '@treDeSpaceUI/widgets';
import { VALUE_REF_RE } from '../../../lib/overlay/overlaySafety';
import { DEFAULT_TOKENS } from '../../../lib/overlay/overlayStyle';
import { overlayEditorState } from '../../../state/animation/overlayEditor.state';

const CUSTOM = '__custom';
const TOKENS = Object.keys(DEFAULT_TOKENS);

/** A colour that is a theme token ($accent…), one of the design's colour
 *  values ({{key}} — every card using the design sets its own) or a custom hex. */
export function ColorTokenField({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowNone?: boolean;
}) {
  const params = overlayEditorState.useSelect((s) => s.working?.params);
  const isToken = value !== undefined && (value.startsWith('$') || VALUE_REF_RE.test(value));
  const options = [
    ...(allowNone ? [{ value: '', label: 'None' }] : []),
    ...TOKENS.map((t) => ({ value: `$${t}`, label: `Theme: ${t}` })),
    ...(params ?? [])
      .filter((p) => p.type === 'color')
      .map((p) => ({ value: `{{${p.key}}}`, label: `Value: ${p.label || p.key}` })),
    { value: CUSTOM, label: 'Custom colour' },
  ];

  return (
    <div className="flex items-center gap-1">
      <Select
        tooltip="A theme colour, one of the design's colour values (each card sets its own), or your own"
        className="min-w-0 flex-1"
        label={label}
        labelPosition="left"
        labelWidth={64}
        value={value === undefined ? (allowNone ? '' : null) : isToken ? value : CUSTOM}
        options={options}
        clearable={false}
        onChange={(v) =>
          onChange(v === '' ? undefined : v === CUSTOM ? (isToken || !value ? '#ffffff' : value) : (v ?? undefined))
        }
      />
      {value !== undefined && !isToken && (
        <ColorSelect tooltip="Your own colour" className="w-14" value={value} onChange={onChange} />
      )}
    </div>
  );
}
