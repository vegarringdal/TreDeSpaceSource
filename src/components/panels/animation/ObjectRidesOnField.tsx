import { Select, type SelectOption } from '@treDeSpaceUI/widgets';
import { useMemo } from 'react';
import type { AnimObject } from '../../../lib/animation/types';
import { ridesOn } from '../../../lib/objectTree';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { activeScene } from '../../../state/animation/docEdit';
import { objectsActions } from '../../../state/animation/objects.actions';

/** What the object rides on: the object whose motion carries it (its keys
 *  are then counted from that one). Filled in by + Object when the object is
 *  made inside another; cleared to detach. Changing it keeps the object
 *  where it stands at each of its keys. */
export function ObjectRidesOnField({ object, labelWidth }: { object: AnimObject; labelWidth: number }) {
  const doc = animationDocState.useSelect((s) => s.doc);
  const options = useMemo<SelectOption[]>(() => {
    const objects = activeScene(doc)?.objects ?? [];
    return objects
      .filter((o) => o.id !== object.id && !ridesOn(objects, o.id, object.id))
      .map((o) => ({ value: o.id, label: o.name || 'Object' }));
  }, [doc, object.id]);

  return (
    <Select
      label="Rides on"
      labelPosition="left"
      labelWidth={labelWidth}
      placeholder="Nothing — it stands on its own"
      tooltip="The object this one rides on: that one's motion carries it, and its own keys play on top. It also follows that one's hide, opacity and colour keys unless it has its own. Set by + Object when made inside another object; clear it to detach. Changing it keeps the object where it stands at each of its keys."
      shortcut="animation.object.detach"
      value={object.parent ?? null}
      options={options}
      searchable
      onChange={(parent) => objectsActions.setParent(object.id, parent)}
    />
  );
}
