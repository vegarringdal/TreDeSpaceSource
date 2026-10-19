import { IconCopy, IconKey, IconKeyOff, IconPalette, IconTrash } from '@tabler/icons-react';
import { Button, NumberInput, Select } from '@treDeSpaceUI/widgets';
import type { Callout, Scene } from '../../../lib/animation/types';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../../../lib/overlay/overlayStyle';
import type { OverlayInstance } from '../../../lib/overlay/overlayTypes';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { calloutsActions as ov } from '../../../state/animation/callouts.actions';
import { overlayEditorActions } from '../../../state/animation/overlayEditor.actions';
import { findComponent } from '../../../state/animation/runtimeOverlay';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { useOverlayThemeOptions } from '../shared/useOverlayThemeOptions';
import { CalloutTimeFields } from './CalloutTimeFields';
import { InspectorFrame } from './InspectorFrame';
import { OverlayAnchorFields } from './OverlayAnchorFields';
import { OverlayValueFields } from './OverlayValueFields';

/** A callout: its design (+ Edit style… / Detach), values, where it sits,
 *  position keys, size, when it shows and its effects. */
export function KeyCallout({
  scene,
  callout,
  instance: inst,
}: {
  scene: Scene;
  callout: Callout;
  instance: OverlayInstance | null;
}) {
  const lib = overlayLibraryState.use();
  const themes = useOverlayThemeOptions();
  const doc = animationDocState.use().doc;
  const comp = inst ? findComponent(doc, inst.component) : null;
  const actions = (
    <Button
      shortcut="animation.overlay.remove"
      iconOnly
      size="sm"
      variant="ghost"
      icon={<IconTrash />}
      tooltip="Remove this overlay"
      onClick={() => ov.remove(callout.id)}
    />
  );
  if (!inst) {
    // the file names an overlay it does not carry (Problems › Go to)
    return (
      <InspectorFrame kind="Overlay" name="Overlay missing" actions={actions}>
        <span className="text-[11px] text-slate-400">
          This callout shows an overlay that is not in the file, so nothing is drawn — remove it, or add the overlay
          again from the Overlays row.
        </span>
      </InspectorFrame>
    );
  }
  const id = inst.id;
  const keys = callout.keys?.length ?? 0;

  return (
    <InspectorFrame kind="Overlay" name={comp?.name ?? inst.component} actions={actions}>
      <Select
        tooltip="The design this overlay uses"
        label="Design"
        labelPosition="left"
        labelWidth={56}
        value={inst.component}
        options={lib.components.map((c) => ({ value: c.id, label: c.name }))}
        clearable={false}
        onChange={(v) => v && ov.updateInstance(id, { component: v })}
      />
      <Select
        tooltip="Its colour theme — Auto follows the app's light / dark theme"
        label="Theme"
        labelPosition="left"
        labelWidth={56}
        value={themes.toValue(inst.theme)}
        options={themes.options}
        clearable={false}
        onChange={(v) => ov.updateInstance(id, { theme: themes.fromValue(v) })}
      />
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          icon={<IconPalette />}
          tooltip="Restyle the design in the Overlay Editor (applies everywhere it is used)"
          shortcut="animation.overlay.editStyle"
          onClick={() => overlayEditorActions.editInstanceStyle(inst.id)}
        >
          Edit style…
        </Button>
        <Button
          size="sm"
          icon={<IconCopy />}
          tooltip="Give this overlay its own copy of the design (a one-off style)"
          shortcut="animation.overlay.detach"
          onClick={() => overlayEditorActions.detach(id)}
        >
          Detach
        </Button>
      </div>
      {comp && (
        <OverlayValueFields component={comp} values={inst.values} onChange={(k, v) => ov.setValue(inst.id, k, v)} />
      )}
      <OverlayAnchorFields scene={scene} instance={inst} />
      <div className="flex items-center gap-1 text-xs">
        <span className="min-w-0 flex-1 truncate text-slate-400">
          {keys
            ? `${keys} position key(s) — drag it in the view to key the time slider`
            : 'One place — key it to move it over time'}
        </span>
        <Button
          size="sm"
          icon={<IconKey />}
          tooltip="A position key at the time slider (where it is now); after that, dragging it in the view keys the time slider"
          shortcut="animation.overlay.keyHere"
          onClick={() => ov.keyHere(callout.id)}
        >
          Key here
        </Button>
        <Button
          size="sm"
          icon={<IconKeyOff />}
          disabled={keys === 0}
          tooltip="Remove every position key — the overlay keeps one place"
          shortcut="animation.overlay.clearKeys"
          onClick={() => ov.clearKeys(callout.id)}
        >
          Clear
        </Button>
      </div>
      <NumberInput
        tooltip="The overlay's size on screen"
        decShortcut="animation.overlay.scale.dec"
        incShortcut="animation.overlay.scale.inc"
        label="Scale"
        labelPosition="left"
        labelWidth={56}
        value={inst.scale}
        min={0.1}
        max={10}
        step={0.05}
        unit="×"
        onChange={(v) => ov.updateInstance(id, { scale: v }, `ov-scale:${id}`)}
      />
      <NumberInput
        tooltip="Every text in this overlay this many times its designed size — padding and boxes stay as designed"
        decShortcut="animation.overlay.textScale.dec"
        incShortcut="animation.overlay.textScale.inc"
        label="Text size"
        labelPosition="left"
        labelWidth={56}
        value={inst.textScale ?? 1}
        min={TEXT_SCALE_MIN}
        max={TEXT_SCALE_MAX}
        step={0.05}
        unit="×"
        onChange={(v) => ov.updateInstance(id, { textScale: v }, `ov-text:${id}`)}
      />
      <CalloutTimeFields callout={callout} />
    </InspectorFrame>
  );
}
