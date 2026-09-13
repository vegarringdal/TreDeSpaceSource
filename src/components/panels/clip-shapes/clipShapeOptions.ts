/** The shape gizmo's three modes — an exclusive choice, so one segmented run. */
export const GIZMO_MODES = [
  {
    value: 'move',
    label: 'Move',
    tooltip: 'Shape gizmo: move (arm a shape with its Gizmo button)',
    shortcut: 'clip.shape.gizmo.move',
  },
  {
    value: 'rotate',
    label: 'Rotate',
    tooltip: 'Shape gizmo: rotate (arm a shape with its Gizmo button)',
    shortcut: 'clip.shape.gizmo.rotate',
  },
  {
    value: 'scale',
    label: 'Scale',
    tooltip: 'Shape gizmo: scale (arm a shape with its Gizmo button)',
    shortcut: 'clip.shape.gizmo.scale',
  },
] as const;
