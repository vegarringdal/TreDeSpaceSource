import { Collapsible } from '@treDeSpaceUI/widgets';

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
      {CAMERA_CONTROLS.map((c) => (
        <div key={c.desc} className="flex items-center gap-2 py-1">
          <div className="flex-1 text-[11px] text-slate-300">{c.desc}</div>
          <code className="shrink-0 whitespace-nowrap border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-300">
            {c.keys}
          </code>
        </div>
      ))}
    </Collapsible>
  );
}
