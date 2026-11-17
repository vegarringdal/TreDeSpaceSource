import { Checkbox } from '@treDeSpaceUI/widgets';
import { type AnnotationKind, annotationsActions } from '../../../state/animation/annotations.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { measurementsState } from '../../../state/viewer/measurements.state';

/** Rows listed before "+ n more". */
const LIST_MAX = 12;

/** What is on screen of one kind, each switched on or off (a label's mute,
 *  a measurement's visibility) — part of the key. */
export function AnnotationToggleList({ kind }: { kind: AnnotationKind }) {
  const labels = labelsState.useSelect((s) => s.items);
  const measurements = measurementsState.useSelect((s) => s.items);
  const rows =
    kind === 'labels'
      ? labels.map((l) => ({ id: l.id, name: l.text.split('\n')[0] || 'Label', on: !l.muted }))
      : measurements.map((m) => ({ id: m.id, name: m.label || m.kind, on: m.visible }));
  if (rows.length === 0) {
    return <span className="text-[11px] text-slate-500">None on screen.</span>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {rows.slice(0, LIST_MAX).map((r) => (
        <Checkbox
          key={r.id}
          label={r.name}
          checked={r.on}
          tooltip={r.on ? 'Shown — untick to hide it from this key on' : 'Hidden — tick to show it from this key on'}
          onChange={() => annotationsActions.toggle(kind, r.id)}
        />
      ))}
      {rows.length > LIST_MAX && <span className="text-[11px] text-slate-500">+ {rows.length - LIST_MAX} more</span>}
    </div>
  );
}
