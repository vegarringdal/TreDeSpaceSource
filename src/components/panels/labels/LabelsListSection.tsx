import { IconCrosshair, IconTrash } from '@tabler/icons-react';
import { Button, Collapsible, EmptyState, Swatch, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';

/** Labels → the per-label list: select swatch, text, reposition and delete. */
export function LabelsListSection() {
  const s = labelsState.use();

  return (
    <Collapsible title={`Labels (${s.items.length})`}>
      {s.items.length === 0 && <EmptyState>No labels yet.</EmptyState>}
      {s.items.map((l) => (
        <div
          key={l.id}
          className={`flex flex-col gap-1 border p-1 ${l.selected ? 'border-blue-400 border-dashed' : 'border-slate-800'}`}
        >
          <div className="flex items-center gap-1">
            <Swatch color={l.bg} tooltip="Toggle selected" onClick={() => act.toggleSelect(l.id)} />
            {s.richText ? (
              <TextArea className="min-w-0 flex-1" rows={2} value={l.text} onChange={(v) => act.setText(l.id, v)} />
            ) : (
              <TextInput className="min-w-0 flex-1" value={l.text} onChange={(v) => act.setText(l.id, v)} />
            )}
            <Button
              iconOnly
              icon={<IconCrosshair size={14} />}
              active={s.repositionId === l.id}
              tooltip="Move this label: activate, then click the new spot in the model (disarms after one click)"
              onClick={() => act.startReposition(l.id)}
            />
            <Button
              iconOnly
              icon={<IconTrash size={14} />}
              tooltip="Delete this label"
              onClick={() => act.remove(l.id)}
            />
          </div>
          <TextInput
            className="min-w-0 opacity-60"
            value={l.fullname ?? ''}
            placeholder="Linked fullname (used for import dedupe)"
            onChange={(v) => act.setFullname(l.id, v)}
          />
        </div>
      ))}
    </Collapsible>
  );
}
