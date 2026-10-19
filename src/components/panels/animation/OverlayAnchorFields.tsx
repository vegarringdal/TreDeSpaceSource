import { Checkbox, ColorSelect, NumberInput, SegmentedControl, Select, toast } from '@treDeSpaceUI/widgets';
import type { Scene, V3 } from '../../../lib/animation/types';
import {
  DEFAULT_LEADER_COLOR,
  type OverlayAnchor,
  type OverlayInstance,
  type Pin,
} from '../../../lib/overlay/overlayTypes';
import { pinPlace } from '../../../lib/overlay/pinPlace';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { calloutsActions } from '../../../state/animation/callouts.actions';
import { rowObject } from '../../../state/animation/rows';
import { objectPoint, runtimeRenderer } from '../../../state/animation/runtime';

const KINDS = [
  {
    value: 'screen',
    label: 'Screen',
    tooltip: 'Pinned to a place on the screen',
    shortcut: 'animation.overlay.anchor.screen',
  },
  {
    value: 'object',
    label: 'Object',
    tooltip: 'Hangs from an object and follows it',
    shortcut: 'animation.overlay.anchor.object',
  },
  {
    value: 'world',
    label: 'Point',
    tooltip: 'Hangs from a fixed point in the model',
    shortcut: 'animation.overlay.anchor.world',
  },
] as const;

/** The nine screen pins, in reading order (also the step cards' places). */
export const PIN_OPTIONS: readonly { value: Pin; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 't', label: 'Top' },
  { value: 'tr', label: 'Top right' },
  { value: 'l', label: 'Left' },
  { value: 'c', label: 'Centre' },
  { value: 'r', label: 'Right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'b', label: 'Bottom' },
  { value: 'br', label: 'Bottom right' },
];

/** The object an overlay switched to Object hangs from: the current
 *  object row, else the first object selected, else the first object. */
function anchorObject(scene: Scene): string | null {
  const ui = animationUiState.get();
  const current = rowObject(ui.current);
  const has = (id: string | null | undefined): id is string => !!id && scene.objects.some((o) => o.id === id);
  if (has(current)) {
    return current;
  }
  const selected = ui.objectSelection.find((id) => has(id));
  return selected ?? scene.objects[0]?.id ?? null;
}

/** What the view looks at (a Point anchor starts there, on screen). */
function viewTarget(): V3 {
  const t = runtimeRenderer()?.camera.target;
  return t ? [t[0], t[1], t[2]] : [0, 0, 0];
}

/** Where an overlay sits: screen position + pin, or an object / point with
 *  a leader-line offset. Dragging the card in the viewport edits the same. */
export function OverlayAnchorFields({ scene, instance }: { scene: Scene; instance: OverlayInstance }) {
  const a = instance.anchor;
  const set = (anchor: OverlayAnchor, key?: string) =>
    calloutsActions.updateInstance(instance.id, { anchor }, key && `ov-anchor:${instance.id}`);

  const switchKind = (k: OverlayAnchor['kind']) => {
    if (k === 'screen') {
      set({ kind: 'screen', pos: [0.5, 0.15], pin: 't' });
    } else if (k === 'object') {
      const object = anchorObject(scene);
      if (!object) {
        toast.info('Make an object first (+ Object) — an overlay hangs from one.');
        return;
      }
      set({ kind: 'object', object, offset: [80, -70], leader: true });
    } else {
      const p = a.kind === 'object' ? objectPoint(a.object) : null;
      set({ kind: 'world', pos: p ?? viewTarget(), offset: [80, -70], leader: true });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="w-14 text-[11px] text-slate-400">Anchor</span>
        <SegmentedControl value={a.kind} options={KINDS} onChange={switchKind} />
      </div>
      {a.kind === 'screen' && (
        <>
          <Select
            tooltip="Which corner or edge of the view it is pinned to — it moves there (X / Y fine-tune it)"
            label="Pin"
            labelPosition="left"
            labelWidth={56}
            value={a.pin}
            options={PIN_OPTIONS}
            clearable={false}
            onChange={(p) => p && set({ ...a, pin: p, pos: pinPlace(p) })}
          />
          <div className="grid grid-cols-2 gap-1">
            <NumberInput
              tooltip="Horizontal position (0 = left, 1 = right)"
              decShortcut="animation.overlay.x.dec"
              incShortcut="animation.overlay.x.inc"
              label="X"
              labelPosition="left"
              labelWidth={20}
              value={a.pos[0]}
              min={0}
              max={1}
              step={0.01}
              onChange={(x) => set({ ...a, pos: [x, a.pos[1]] }, 'x')}
            />
            <NumberInput
              tooltip="Vertical position (0 = top, 1 = bottom)"
              decShortcut="animation.overlay.y.dec"
              incShortcut="animation.overlay.y.inc"
              label="Y"
              labelPosition="left"
              labelWidth={20}
              value={a.pos[1]}
              min={0}
              max={1}
              step={0.01}
              onChange={(y) => set({ ...a, pos: [a.pos[0], y] }, 'y')}
            />
          </div>
        </>
      )}
      {a.kind === 'object' && (
        <Select
          tooltip="The object the overlay hangs from"
          label="Object"
          labelPosition="left"
          labelWidth={56}
          value={a.object || null}
          options={scene.objects.map((x) => ({ value: x.id, label: x.name || 'Object' }))}
          clearable={false}
          onChange={(id) => id && set({ ...a, object: id })}
        />
      )}
      {a.kind !== 'screen' && (
        <>
          <div className="grid grid-cols-2 gap-1">
            <NumberInput
              tooltip="Label offset from the object, sideways (px)"
              decShortcut="animation.overlay.dx.dec"
              incShortcut="animation.overlay.dx.inc"
              label="dx"
              labelPosition="left"
              labelWidth={20}
              value={a.offset[0]}
              step={5}
              unit="px"
              onChange={(x) => set({ ...a, offset: [x, a.offset[1]] }, 'dx')}
            />
            <NumberInput
              tooltip="Label offset from the object, up / down (px)"
              decShortcut="animation.overlay.dy.dec"
              incShortcut="animation.overlay.dy.inc"
              label="dy"
              labelPosition="left"
              labelWidth={20}
              value={a.offset[1]}
              step={5}
              unit="px"
              onChange={(y) => set({ ...a, offset: [a.offset[0], y] }, 'dy')}
            />
          </div>
          <Checkbox
            tooltip="Draw a line from the label to the object"
            shortcut="animation.overlay.leader"
            label="Leader line"
            checked={a.leader}
            onChange={(leader) => set({ ...a, leader })}
          />
          {a.leader && (
            <ColorSelect
              label="Leader colour"
              labelPosition="split"
              tooltip="Colour of the line and dot that tie the label to its object"
              value={a.leaderColor ?? DEFAULT_LEADER_COLOR}
              onChange={(leaderColor) => set({ ...a, leaderColor }, 'leader-color')}
            />
          )}
        </>
      )}
    </div>
  );
}
