import { describe, expect, it } from 'vitest';
import { videoFrameTimes } from '../src/lib/animation/videoFrames';

describe('video frame plan', () => {
  it('spaces frames at the frame rate and ends on the last time', () => {
    expect(videoFrameTimes({ from: 1, to: 2, fps: 4, holds: [] })).toEqual([1, 1.25, 1.5, 1.75, 2]);
    const t = videoFrameTimes({ from: 0, to: 1.1, fps: 2, holds: [] });
    expect(t).toEqual([0, 0.5, 1, 1.1]);
  });

  it('waits at a hold before going on', () => {
    expect(videoFrameTimes({ from: 0, to: 1, fps: 4, holds: [{ at: 0.5, seconds: 0.5 }] })).toEqual([
      0, 0.25, 0.5, 0.5, 0.5, 0.75, 1,
    ]);
  });

  it('holds between frames, at the end, and ignores holds outside the range', () => {
    const t = videoFrameTimes({
      from: 0,
      to: 1,
      fps: 2,
      holds: [
        { at: 0.7, seconds: 1 },
        { at: 1, seconds: 0.5 },
        { at: 3, seconds: 1 },
      ],
    });
    expect(t).toEqual([0, 0.5, 0.7, 0.7, 1, 1]);
  });
});
