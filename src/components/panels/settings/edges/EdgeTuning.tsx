import { NumberInput } from '@treDeSpaceUI/widgets';

type ThresholdField = {
  value: number;
  onChange: (x: number) => void;
  decShortcut: string;
  incShortcut: string;
};

/** The fade / depth-threshold / normal-threshold triple shared by every edge
 *  category (flat, with-normals, sketch) — same ranges, different state keys. */
export function EdgeTuning({
  fade,
  depth,
  normal,
}: {
  fade: ThresholdField;
  depth: ThresholdField;
  normal: ThresholdField;
}) {
  return (
    <>
      <NumberInput
        label="Fade"
        labelPosition="split"
        value={fade.value}
        min={0}
        max={2}
        step={0.05}
        decShortcut={fade.decShortcut}
        incShortcut={fade.incShortcut}
        onChange={fade.onChange}
      />
      <NumberInput
        label="Depth thr."
        labelPosition="split"
        value={depth.value}
        min={0}
        max={0.2}
        step={0.005}
        precision={3}
        decShortcut={depth.decShortcut}
        incShortcut={depth.incShortcut}
        onChange={depth.onChange}
      />
      <NumberInput
        label="Normal thr."
        labelPosition="split"
        value={normal.value}
        min={0}
        max={1}
        step={0.05}
        decShortcut={normal.decShortcut}
        incShortcut={normal.incShortcut}
        onChange={normal.onChange}
      />
    </>
  );
}
