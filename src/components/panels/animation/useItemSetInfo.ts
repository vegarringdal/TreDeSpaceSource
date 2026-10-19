import { useEffect, useState } from 'react';
import type { AnimObject } from '../../../lib/animation/types';
import type { ClosestGroup } from '../../../lib/modeldb/apiAnimation';
import { objectItemsActions } from '../../../state/animation/objectItems.actions';
import { selectionState } from '../../../state/viewer/selection.state';

type ItemSetInfo = { count: number | null; group: ClosestGroup | null; names: Readonly<Record<string, string>> };

/** What an object's item lists come to in the loaded models: how many items
 *  (null while counting), the closest group naming them more simply (null:
 *  none) and each entry as the tree spells it — asked again when its lists
 *  or the models change. */
export function useItemSetInfo(object: AnimObject): ItemSetInfo {
  const [info, setInfo] = useState<ItemSetInfo>({ count: null, group: null, names: {} });
  const models = selectionState.useSelect((s) => s.modelsVersion);
  const key = `${object.id}|${object.items.join(',')}|${(object.exclude ?? []).join(',')}|${models}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the object's lists and the models
  useEffect(() => {
    let live = true;
    void Promise.all([
      objectItemsActions.count(object.id),
      objectItemsActions.closestGroup(object.id),
      objectItemsActions.treeNames(object.id),
    ]).then(([count, group, names]) => {
      if (live) {
        setInfo({ count, group, names });
      }
    });
    return () => {
      live = false;
    };
  }, [key]);

  return info;
}
