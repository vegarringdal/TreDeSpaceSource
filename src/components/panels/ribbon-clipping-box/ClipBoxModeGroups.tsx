import { IconArrowsUpDown, IconBox, IconCrop } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { ribbonClippingBoxActions as act } from './ribbonClippingBox.actions';
import { ribbonClippingBoxState } from './ribbonClippingBox.state';

const MODES = ['none', 'move', 'rotate', 'scale'] as const;

/** Clipping-box on/off, helper visibility, cut direction and gizmo mode. */
export function ClipBoxModeGroups() {
  const s = ribbonClippingBoxState.use();

  return (
    <>
      <RibbonSection title="On/Off">
        <RibbonButton
          icon={<IconCrop />}
          label="Enable"
          selected={s.enabled}
          shortcut="clip.box.enable"
          onClick={act.toggleEnabled}
        />
      </RibbonSection>

      <RibbonSection title="Helper">
        <RibbonButton
          icon={<IconBox />}
          label="Box"
          selected={s.helper}
          shortcut="clip.box.helper"
          onClick={act.toggleHelper}
        />
      </RibbonSection>

      <RibbonSection title="Cut dir">
        <RibbonButton icon={<IconArrowsUpDown />} label="Flip" shortcut="clip.box.flip" onClick={act.flipCutDir} />
      </RibbonSection>

      <RibbonSection title="Gizmo mode">
        {MODES.map((m) => (
          <RibbonButton
            key={m}
            size="medium"
            label={m[0].toUpperCase() + m.slice(1)}
            selected={s.gizmoMode === m}
            shortcut={`clip.box.gizmo.${m}`}
            onClick={() => act.setGizmoMode(m)}
          />
        ))}
        <RibbonButton
          size="big"
          label={s.sixAxis ? '6 Axis' : '3 Axis'}
          selected={s.sixAxis}
          disabled={s.gizmoMode !== 'scale'}
          tooltip={'Scale tool handles:\n3 axis = symmetric, 6 axis = per face'}
          shortcut="clip.box.sixAxis"
          onClick={act.toggleSixAxis}
        />
      </RibbonSection>
    </>
  );
}
