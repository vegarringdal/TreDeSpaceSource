import { describe, expect, it } from 'vitest';
import { viewpointStepId } from '../src/state/viewer/viewpointStep';

const IDS = ['a', 'b', 'c'];

describe('viewpointStepId — the Viewpoint Viewer Prev / Next target', () => {
  it('steps to the neighbour in list order', () => {
    expect(viewpointStepId(IDS, 'b', 1)).toBe('c');
    expect(viewpointStepId(IDS, 'b', -1)).toBe('a');
  });

  it('stops at the ends instead of wrapping around', () => {
    expect(viewpointStepId(IDS, 'c', 1)).toBeNull();
    expect(viewpointStepId(IDS, 'a', -1)).toBeNull();
  });

  it('with nothing active, Next starts at the first and Prev at the last', () => {
    expect(viewpointStepId(IDS, null, 1)).toBe('a');
    expect(viewpointStepId(IDS, null, -1)).toBe('c');
  });

  it('treats an active id that is no longer in the list as nothing active', () => {
    expect(viewpointStepId(IDS, 'gone', 1)).toBe('a');
    expect(viewpointStepId(IDS, 'gone', -1)).toBe('c');
  });

  it('has nowhere to go in an empty list', () => {
    expect(viewpointStepId([], null, 1)).toBeNull();
    expect(viewpointStepId([], 'a', -1)).toBeNull();
  });
});
