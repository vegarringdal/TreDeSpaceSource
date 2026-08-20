import { Button } from '@treDeSpaceUI/widgets';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

const sampleLine = (from: number, label: string) => ({
  kind: 'line' as const,
  points: [{ pos: [from, 0, 0] as [number, number, number] }, { pos: [from + 1, 1, 1] as [number, number, number] }],
  label,
});

export function MeasurementsSection() {
  const { run, c } = useDemo();

  const handleSet = () => {
    const measurements = [sampleLine(0, 'demo line')];
    void run('measurements.set', { measurements }, () => c().measurementsSet(measurements));
  };

  const handleAdd = () => {
    const measurements = [sampleLine(1, 'demo line (added)')];
    void run('measurements.add', { measurements }, () => c().measurementsAdd(measurements));
  };

  return (
    <DemoSection title="Measurements">
      <Row>
        <Button onClick={handleSet}>measurements.set (sample line)</Button>
        <Button onClick={handleAdd}>measurements.add (sample line)</Button>
        <Button onClick={() => void run('measurements.clear', {}, () => c().measurementsClear())}>
          measurements.clear
        </Button>
      </Row>
    </DemoSection>
  );
}
