import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface RibbonMeasurementsState {
  tool: 'off' | 'point' | 'line' | 'path' | 'area' | 'diameter' | 'angle' | 'face';
}

export const ribbonMeasurementsState = createStore<RibbonMeasurementsState>({ tool: 'off' });
