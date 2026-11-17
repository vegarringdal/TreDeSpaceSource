// Opener slots for the viewpoint panels (same pattern as importManagerPanel):
// modules that can't reach the DockManager (hotkeys, other panels) call these;
// App.tsx wires them to manager.openPanel at mount.
import { makeCallbackSlot } from '../panelRegistry';

const viewpoints = makeCallbackSlot();
export const registerViewpointsOpener = viewpoints.register;
export const openViewpointsPanel = viewpoints.call;

const viewer = makeCallbackSlot();
export const registerViewpointViewerOpener = viewer.register;
export const openViewpointViewerPanel = viewer.call;

// forced-right variant for the postMessage API's `showViewer` option: a host
// that just loaded viewpoints wants the presentation panel docked RIGHT and
// active, regardless of the panel's left home or the current layout
const viewerRight = makeCallbackSlot();
export const registerViewpointViewerRightOpener = viewerRight.register;
export const openViewpointViewerPanelRight = viewerRight.call;

const labels = makeCallbackSlot();
export const registerLabelsViewpointOpener = labels.register;
export const openLabelsViewpointPanel = labels.call;

const measurements = makeCallbackSlot();
export const registerMeasurementsViewpointOpener = measurements.register;
export const openMeasurementsViewpointPanel = measurements.call;

const multiColor = makeCallbackSlot();
export const registerMultiColorViewpointOpener = multiColor.register;
export const openMultiColorViewpointPanel = multiColor.call;
