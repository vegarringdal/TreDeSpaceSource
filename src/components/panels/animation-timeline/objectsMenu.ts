import type { MenuEntry } from '@treDeSpaceUI/widgets';
import { activeScene } from '../../../state/animation/docEdit';
import { objectsActions } from '../../../state/animation/objects.actions';

/** The + Object split button's menu (and the Objects row's): many objects
 *  at once from the selection — one per child of each selected node, or one
 *  per selected node — each keyed at the time slider, and every object's
 *  items selected so one gizmo drag poses them all. */
export function objectsMenuItems(): MenuEntry[] {
  const count = activeScene()?.objects.length ?? 0;
  return [
    {
      id: 'children',
      label: '+ Objects: one per child',
      tooltip: 'Each child of every selected node becomes an object (a group becomes its parts)',
      shortcut: 'animation.objects.children',
      onSelect: () => void objectsActions.fromSelectionParts('children'),
    },
    {
      id: 'nodes',
      label: '+ Objects: one per selected node',
      tooltip: 'Each selected node becomes an object of its own',
      shortcut: 'animation.objects.nodes',
      onSelect: () => void objectsActions.fromSelectionParts('nodes'),
    },
    { separator: true },
    {
      id: 'selectAll',
      label: 'Select all the objects',
      tooltip: "Every object's items selected: one gizmo drag poses them all, Key keys each",
      disabled: count === 0,
      shortcut: 'animation.objects.selectAll',
      onSelect: () => void objectsActions.selectObjects(activeScene()?.objects.map((o) => o.id) ?? []),
    },
  ];
}
