import { IconEyeOff, IconKey, IconTrash, IconUpload } from '@tabler/icons-react';
import { Button, TimeInput } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { type AnnotationKind, annotationsActions } from '../../../state/animation/annotations.actions';
import { keysActions } from '../../../state/animation/keys.actions';
import { AnnotationToggleList } from './AnnotationToggleList';
import { InspectorFrame } from './InspectorFrame';

const LABEL_W = 56;

const TEXT = {
  labels: {
    row: '@labels',
    title: 'Labels',
    tool: 'the Label panel',
    shortcuts: { key: 'animation.labelsKey', fromScene: 'animation.labels.fromScene', none: 'animation.labels.none' },
  },
  measurements: {
    row: '@measurements',
    title: 'Measurements',
    tool: 'the Measurement ribbon and list',
    shortcuts: {
      key: 'animation.measurementsKey',
      fromScene: 'animation.measurements.fromScene',
      none: 'animation.measurements.none',
    },
  },
} as const;

/** The Labels or Measurements row, or one of its keys: the set on screen from
 *  a time on — made with the normal tools, each one switched on or off here. */
export function KeyAnnotations({ kind, scene, index }: { kind: AnnotationKind; scene: Scene; index: number | null }) {
  const t = TEXT[kind];
  const pending = animationUiState.useSelect((s) => (kind === 'labels' ? s.previewLabels : s.previewMeasurements));
  const keys = kind === 'labels' ? scene.labels : scene.measurements;
  const key = index !== null ? keys[index] : undefined;
  const inScene = annotationsActions.sceneCounts()[kind];

  const keyButton = (
    <Button
      size="sm"
      icon={<IconKey />}
      tooltip={`The ${kind} on screen as a key at the time slider (I)`}
      shortcut={t.shortcuts.key}
      onClick={() => annotationsActions.key(kind)}
    >
      Key {kind}
    </Button>
  );

  return (
    <InspectorFrame
      kind={key ? `${t.title} key` : t.title}
      name={key ? `${key.t.toFixed(2)} s` : `${keys.length} key${keys.length === 1 ? '' : 's'}`}
      actions={keyButton}
    >
      {key && index !== null && (
        <div className="flex items-center gap-1">
          <TimeInput
            className="min-w-0 flex-1"
            label="Time"
            tooltip="This key's time (s) — the set shows from here on"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={key.t}
            onChange={(time) => keysActions.setTime(t.row, index, time)}
          />
          <Button
            iconOnly
            size="sm"
            variant="ghost"
            icon={<IconTrash />}
            tooltip="Delete this key"
            shortcut="animation.deleteKey"
            onClick={() => keysActions.deleteKeys(t.row, [index])}
          />
        </div>
      )}
      <AnnotationToggleList kind={kind} />
      {pending && <span className="text-[11px] text-amber-300">Changed — not keyed yet. Key {kind} keys it.</span>}
      <span className="text-[11px] text-slate-400">
        {key
          ? `Shown from this key on, until the next. Edit them with ${t.tool} — changes go into this key.`
          : `Add or change ${kind} with ${t.tool}, switch them on or off here, then Key ${kind}: they show from the time slider on. They stay where they are in the model.`}
      </span>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          icon={<IconUpload />}
          disabled={inScene === 0}
          tooltip={`Bring in the scene's own ${kind} (put aside while animating)`}
          shortcut={t.shortcuts.fromScene}
          onClick={() => annotationsActions.fromScene(kind)}
        >
          From the scene ({inScene})
        </Button>
        <Button
          size="sm"
          icon={<IconEyeOff />}
          tooltip={`No ${kind} from the time slider on (a key with none)`}
          shortcut={t.shortcuts.none}
          onClick={() => annotationsActions.none(kind)}
        >
          None from here
        </Button>
      </div>
    </InspectorFrame>
  );
}
