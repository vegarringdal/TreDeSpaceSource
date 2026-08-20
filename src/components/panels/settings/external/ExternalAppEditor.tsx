import { Button, Collapsible, Select, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { type ExternalApp, type ExternalAppSize, externalAppsActions } from '../../../../state/externalApps.state';
import { Check } from '../Check';

/** One editable external-app entry (name, URL, section, size, flags). */
export function ExternalAppEditor({ app }: { app: ExternalApp }) {
  const a = app;

  return (
    <Collapsible title={a.name || a.url || 'Untitled app'} aside={a.section || undefined} defaultOpen={false}>
      <div className="flex items-center gap-1.5">
        <TextInput
          className="w-36 shrink-0"
          value={a.name}
          placeholder="Button name"
          onChange={(v) => externalAppsActions.update(a.id, { name: v })}
        />
        <TextInput
          value={a.url}
          placeholder="https://tool.example.com/…"
          onChange={(v) => externalAppsActions.update(a.id, { url: v })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <TextInput
          className="w-36 shrink-0"
          value={a.section}
          placeholder="Section (ribbon group)"
          onChange={(v) => externalAppsActions.update(a.id, { section: v })}
        />
        <Select
          className="w-28"
          value={a.size}
          options={[
            { value: 'big', label: 'Big' },
            { value: 'medium', label: 'Medium' },
            { value: 'small', label: 'Small' },
          ]}
          onChange={(v) => externalAppsActions.update(a.id, { size: (v ?? 'medium') as ExternalAppSize })}
        />
      </div>
      <TextArea
        rows={2}
        value={a.tooltip}
        placeholder="Button tooltip (empty = show the URL)"
        onChange={(v) => externalAppsActions.update(a.id, { tooltip: v })}
      />
      <TextArea
        rows={2}
        value={a.config}
        placeholder={
          'Config JSON — sent as ?config=… (e.g. {"project":"X"}); modal size: {"width":"600px","height":"60%"}'
        }
        onChange={(v) => externalAppsActions.update(a.id, { config: v })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Check
          label="Multiple instances"
          tooltip="A fresh panel instance per click (panels only)"
          checked={a.multiple}
          onChange={(x) => externalAppsActions.update(a.id, { multiple: x })}
        />
        <Check
          label="New window"
          tooltip="Open in a new browser tab instead of an in-app panel"
          checked={a.newWindow}
          onChange={(x) => externalAppsActions.update(a.id, { newWindow: x })}
        />
        <Check
          label="Modal dialog"
          tooltip="Open as a centered modal dialog; the app's own loading/error dialogs still layer above it"
          checked={a.modal}
          onChange={(x) => externalAppsActions.update(a.id, { modal: x })}
        />
        <Check
          label="Open on start"
          tooltip="Open automatically when the app starts (e.g. a project selector)"
          checked={a.openOnStart}
          onChange={(x) => externalAppsActions.update(a.id, { openOnStart: x })}
        />
        <Button className="ml-auto" tooltip="Remove this external app" onClick={() => externalAppsActions.remove(a.id)}>
          Remove
        </Button>
      </div>
    </Collapsible>
  );
}
