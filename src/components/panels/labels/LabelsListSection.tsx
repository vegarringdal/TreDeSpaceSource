import { IconCrosshair, IconTrash } from '@tabler/icons-react';
import { Button, Collapsible, EmptyState, Swatch, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { formatM } from '../../../state/viewer/measurements.state';
import { useRevealLabelRow } from './useRevealLabelRow';

const AXES = ['X', 'Y', 'Z'] as const;
const COORD_DECIMALS = 3;
/** Height floor of the list: below it the PANEL scrolls instead of the list. */
const LIST_MIN_H = 'min-h-40';

/** Labels → the per-label list: select swatch, text, reposition and delete,
 *  with the linked fullname and the anchor's X/Y/Z below. Fills the rest of
 *  the panel and scrolls on its own, so the sections above stay in view; a
 *  label clicked in the viewport scrolls its row into view. */
export function LabelsListSection() {
  const s = labelsState.use();
  const { scrollerRef } = useRevealLabelRow(s.reveal);

  return (
    <Collapsible title={`Labels (${s.items.length})`} fill fillMinClass={LIST_MIN_H} bodyClassName="p-0">
      <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {s.items.length === 0 && <EmptyState>No labels yet.</EmptyState>}
        {s.items.map((l) => (
          <div
            key={l.id}
            data-label-id={l.id}
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
            <div
              className="flex gap-x-3 px-1 text-slate-500 text-xs tabular-nums"
              data-tooltip="Anchor point — where the leader line ends — in world coordinates"
            >
              {AXES.map((axis, i) => (
                <span key={axis} className="min-w-0 flex-1">
                  {axis} {formatM(l.anchor[i], COORD_DECIMALS)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Collapsible>
  );
}
