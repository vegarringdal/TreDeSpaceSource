import { Collapsible } from '@treDeSpaceUI/widgets';
import { measurementsState } from '../../../state/viewer/measurements.state';
import { MeasurementRow } from './MeasurementRow';

/** The Measurements list: one editable row per placed measurement. */
export function MeasurementsListSection() {
  const { items, precision } = measurementsState.use();

  return (
    <Collapsible
      title="Measurements"
      aside={items.length}
      info={
        <>
          Pick a tool in the <b>Measurements</b> ribbon, then click surfaces to place points. Line/Diameter finish
          automatically; Path/Area finish on double-click or <b>Enter</b> (<b>Esc</b> cancels, <b>Backspace</b> undoes a
          point). Each row here renames, shows/hides, or deletes a measurement.
        </>
      }
    >
      {items.length === 0 ? (
        <p className="note px-1 py-4 text-center text-slate-500">No measurements yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((m) => (
            <MeasurementRow key={m.id} m={m} precision={precision} />
          ))}
        </div>
      )}
    </Collapsible>
  );
}
