import { Collapsible, Kbd, PropertyList } from '@treDeSpaceUI/widgets';

/** Fixed viewport/camera controls, shown read-only in the Shortcuts panel. */
const CAMERA_CONTROLS = [
  { keys: 'W A S D', desc: 'Move — fly: along view, walk: ground plane' },
  { keys: 'E / Q', desc: 'Move up / down' },
  { keys: 'Shift', desc: 'Move faster (hold)' },
  { keys: '↑ ↓ ← →', desc: 'Pan the view' },
  { keys: 'LMB drag', desc: 'Orbit around the target' },
  { keys: 'RMB drag', desc: 'Pan' },
  { keys: 'Wheel', desc: 'Zoom / dolly' },
  { keys: 'Space + click', desc: 'Fly to the clicked point' },
  { keys: 'Alt + click', desc: 'Re-pivot at the clicked point' },
];

/** The read-only "Camera / navigation" list of fixed, non-rebindable viewport
 *  controls at the bottom of the Shortcuts settings. */
export function CameraControlsSection() {
  return (
    <Collapsible
      title="Camera / navigation"
      aside="fixed"
      defaultOpen={false}
      info="These viewport controls are fixed and cannot be rebound, so they stay consistent."
    >
      <PropertyList
        layout="fill"
        rows={CAMERA_CONTROLS.map((c) => ({ key: c.desc, label: c.desc, value: <Kbd>{c.keys}</Kbd> }))}
      />
    </Collapsible>
  );
}
