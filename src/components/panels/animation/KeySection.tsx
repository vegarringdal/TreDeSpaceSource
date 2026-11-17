import { IconBox, IconEye } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { keysActions } from '../../../state/animation/keys.actions';
import { playerActions } from '../../../state/animation/player.actions';
import { InspectorFrame } from './InspectorFrame';
import { type ArriveOption, KeySceneRowKey } from './KeySceneRowKey';

const ARRIVE: readonly ArriveOption[] = [
  {
    value: 'smooth',
    label: 'Glide',
    tooltip: 'The box and planes glide here',
    shortcut: 'animation.sectionKeys.glide',
  },
  {
    value: 'linear',
    label: 'Even',
    tooltip: 'They move here at an even speed',
    shortcut: 'animation.sectionKeys.even',
  },
  {
    value: 'hold',
    label: 'Switch',
    tooltip: 'The clipping switches at the key',
    shortcut: 'animation.sectionKeys.switch',
  },
];

/** The Clipping row, or one of its keys: the clipping (box, planes, shapes)
 *  at a time — pose it with the clipping ribbons, then Key. */
export function KeySection({ scene, index, indices }: { scene: Scene; index: number | null; indices: number[] }) {
  const key = index !== null ? scene.section[index] : undefined;
  const n = scene.section.length;

  const keyButton = (
    <Button
      size="sm"
      icon={<IconBox />}
      tooltip="The clipping now as a clipping key at the time slider (I)"
      shortcut="animation.sectionKey"
      onClick={() => keysActions.keySection()}
    >
      Key clipping
    </Button>
  );

  return (
    <InspectorFrame
      kind={key ? 'Clipping key' : 'Clipping'}
      name={key ? `${key.t.toFixed(2)} s` : `${n} key${n === 1 ? '' : 's'}`}
      actions={keyButton}
    >
      {key && index !== null && (
        <>
          <KeySceneRowKey
            row="@section"
            index={index}
            indices={indices}
            t={key.t}
            interp={key.interp}
            arrive={ARRIVE}
          />
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              icon={<IconBox />}
              tooltip="This key takes the clipping now"
              shortcut="animation.sectionKey.take"
              onClick={() => keysActions.setSectionValue(index)}
            >
              Take this clipping
            </Button>
            <Button
              size="sm"
              icon={<IconEye />}
              tooltip="The time slider to this key"
              shortcut="animation.sectionKey.goto"
              onClick={() => playerActions.seek(key.t)}
            >
              Go there
            </Button>
          </div>
        </>
      )}
      <span className="text-[11px] text-slate-400">
        Clip the model with the Clipping Box / Clipping Plane ribbons or clip shapes, then Key clipping. Before the
        first key the clipping is as at that key; without keys the model is not clipped.
      </span>
    </InspectorFrame>
  );
}
