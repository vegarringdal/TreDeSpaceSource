import type { PlaneAxis } from './ribbonClippingPlane.state';

/** The three clipping planes in ribbon order, with their legend colors. */
export const AXES: Array<{ axis: PlaneAxis; label: string; dot: string }> = [
  { axis: 'x', label: 'X', dot: 'bg-red-500' },
  { axis: 'y', label: 'Y', dot: 'bg-green-500' },
  { axis: 'z', label: 'Z', dot: 'bg-blue-500' },
];
