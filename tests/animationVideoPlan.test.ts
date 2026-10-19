import { describe, expect, it } from 'vitest';
import { videoFrameTimes, videoSegments } from '../src/lib/animation/videoFrames';
import type { Step } from '../src/lib/animation/types';
import { key, object, scene } from './helpers/animDoc';

function step(id: string, start: number, end: number, pauseAtEnd = false): Step {
  return { id, name: id, text: '', start, end, pauseAtEnd };
}

const assembly = scene({
  id: 'a',
  name: 'Assembly',
  objects: [object('o', [key(0), key(10)])],
  steps: [step('s1', 0, 4, true), step('s2', 4, 10)],
});
const maintenance = scene({ id: 'm', name: 'Maintenance', objects: [object('p', [key(0), key(6)])] });
const empty = scene({ id: 'e', name: 'Empty' });
const scenes = [assembly, empty, maintenance];
const one = { scenes: 'one', scene: 'a', span: 'whole', from: 0, to: 0 } as const;

describe('what a video shows', () => {
  it('all scenes: each whole, one after another, empty ones left out', () => {
    const segs = videoSegments(scenes, { ...one, scenes: 'all' }, 1);
    expect(segs.map((s) => [s.scene, s.from, s.to])).toEqual([
      ['a', 0, 10],
      ['m', 0, 6],
    ]);
    expect(segs[0].holds).toEqual([{ at: 4, seconds: 1 }]);
    expect(segs[1].holds).toEqual([]);
  });

  it('one scene: all of it, or the part from Start to End in either order', () => {
    expect(videoSegments(scenes, one, 0).map((s) => [s.from, s.to])).toEqual([[0, 10]]);
    expect(videoSegments(scenes, { ...one, span: 'part', from: 3, to: 7 }, 0).map((s) => [s.from, s.to])).toEqual([
      [3, 7],
    ]);
    expect(videoSegments(scenes, { ...one, span: 'part', from: 7, to: 3 }, 0).map((s) => [s.from, s.to])).toEqual([
      [3, 7],
    ]);
    expect(videoSegments(scenes, { ...one, span: 'part', from: 8, to: 12 }, 0).map((s) => s.to)).toEqual([12]);
  });

  it('nothing to show: an empty part, an empty or missing scene', () => {
    expect(videoSegments(scenes, { ...one, span: 'part', from: 5, to: 5 }, 0)).toEqual([]);
    expect(videoSegments(scenes, { ...one, scene: 'e' }, 0)).toEqual([]);
    expect(videoSegments(scenes, { ...one, scene: 'nope' }, 0)).toEqual([]);
    expect(videoSegments([empty], { ...one, scenes: 'all' }, 0)).toEqual([]);
  });

  it("frame times per stretch: a waiting step's frames inside the part only", () => {
    const [seg] = videoSegments(scenes, { ...one, span: 'part', from: 2, to: 6 }, 1);
    const times = videoFrameTimes({ ...seg, fps: 10 });
    expect(times.filter((t) => t === 4)).toHaveLength(11);
    expect(times[0]).toBe(2);
    expect(times[times.length - 1]).toBe(6);
  });
});
