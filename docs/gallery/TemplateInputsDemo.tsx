import { ParamListEditor, TemplateTextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

type Param = { key: string; label: string; type: 'text' | 'number' | 'toggle' };

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'toggle', label: 'Toggle' },
] as const;

/** Gallery section for TemplateTextInput and ParamListEditor. */
export function TemplateInputsDemo() {
  const [text, setText] = useState('STEP {{part.index}} / {{part.count}} — {{title}} {{oops}}');
  const [params, setParams] = useState<Param[]>([
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'showProgress', label: 'Show progress', type: 'toggle' },
  ]);
  const placeholders = [
    ...params.map((p) => ({ key: p.key, label: p.label })),
    { key: 'part.index', label: 'Part number' },
    { key: 'part.count', label: 'Number of parts' },
  ];
  return (
    <Section
      title="TemplateTextInput / ParamListEditor"
      note="Template authoring: a text field where {{key}} placeholders are highlighted — known keys blue, unknown red — with a {} menu that inserts one at the caret (replacing any selection); and an editable list of named, typed parameters (key, label, type; reorder, remove, add — keys stay unique and clean, a retype keeps the label, and Add uses the first type)."
      props={['TemplateTextInputProps', 'ParamListEditorProps', 'ParamLike']}
      code={`type Param = { key: string; label: string; type: 'text' | 'number' | 'toggle' };

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'toggle', label: 'Toggle' },
] as const;

function CardTemplate() {
  const [text, setText] = useState('STEP {{part.index}} — {{title}}');
  const [params, setParams] = useState<Param[]>([{ key: 'title', label: 'Title', type: 'text' }]);
  return (
    <>
      <TemplateTextInput
        label="Text"
        value={text}
        placeholders={[...params.map((p) => ({ key: p.key, label: p.label })), { key: 'part.index', label: 'Part number' }]}
        onChange={setText}
      />
      <ParamListEditor value={params} types={TYPES}
        make={(type, key) => ({ key, label: key, type })} onChange={setParams} />
    </>
  );
}`}
    >
      <div className="flex w-96 flex-col gap-3">
        <TemplateTextInput label="One line" value={text} placeholders={placeholders} onChange={setText} />
        <TemplateTextInput label="Multi-line" multiline value={text} placeholders={placeholders} onChange={setText} />
        <ParamListEditor
          value={params}
          types={TYPES}
          make={(type, key) => ({ key, label: key, type })}
          onChange={setParams}
        />
      </div>
    </Section>
  );
}
