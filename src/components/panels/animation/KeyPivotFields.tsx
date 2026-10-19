import { choiceOf } from '../../../lib/animation/pivots';
import type { AnimObject } from '../../../lib/animation/types';
import { keysActions } from '../../../state/animation/keys.actions';
import { sessionRestBounds } from '../../../state/animation/runtime';
import { PivotFields } from './PivotFields';

/** A picked key's pivot and offset — the gizmo turns about it, and dragging
 *  the gizmo's pivot (Transform ribbon › Set pivot) writes the offset. */
export function KeyPivotFields({ object, index }: { object: AnimObject; index: number }) {
  const key = object.keys[index];
  if (!key) {
    return null;
  }

  return (
    <PivotFields
      choice={choiceOf(key.pivot, sessionRestBounds(object.id))}
      onChange={(c) => keysActions.setKeyPivotChoice(object.id, index, c)}
    />
  );
}
