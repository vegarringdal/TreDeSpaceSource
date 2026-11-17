import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { TRANSFORM_RESTING_HINT, useTransformResting } from '../../../state/transform/useTransformResting';
import { TransformObjectsFilesSection } from './TransformObjectsFilesSection';
import { TransformObjectsListSection } from './TransformObjectsListSection';
import { useTransformObjectsImport } from './useTransformObjectsImport';

const MIN_WIDTH = 340;
const MIN_HEIGHT = 200;

/** The Transform Objects panel (opened from the Transform ribbon's List):
 *  every object the ribbon can move, as a tree — what rides on what — with
 *  how far each stands from where the model has it, its numbers to type,
 *  its pivot, and save / load. The top section stays put; the list scrolls. */
export function TransformObjects() {
  useMinSize(MIN_WIDTH, MIN_HEIGHT);
  const { openPicker, pickerElement } = useTransformObjectsImport();
  const isResting = useTransformResting();

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      {isResting && <InfoBox>{TRANSFORM_RESTING_HINT}</InfoBox>}
      <TransformObjectsFilesSection openPicker={openPicker} pickerElement={pickerElement} />
      <TransformObjectsListSection />
    </PanelBody>
  );
}
