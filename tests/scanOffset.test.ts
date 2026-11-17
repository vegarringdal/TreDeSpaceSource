// Scan placement (src/lib/tdpp/scanPlacement.ts): the coordinate system a
// scan is shown in and the user's offset — the stored file moved as a whole
// (origin, axes rotation, setups) with the points untouched.
import { describe, expect, it } from 'vitest';
import { toScene } from '../src/lib/tdpp/cloudFrame';
import { fileSystemName, placeTdpp, placementPose, poseApply, SOURCE_FRAME } from '../src/lib/tdpp/scanPlacement';
import type { TdppCoordSystem, TdppFile } from '../src/lib/tdpp/tdppFormat';

/** The survey-control system of a real project (numbers from its import
 *  report): pose = system → scanner project frame, about −3.66° around Z. */
const CONTROL: TdppCoordSystem = {
  name: 'Control',
  used: false,
  control: true,
  rotation: [0.9994887163642353, 0.00008783936063163207, 0.0000909536054290849, -0.03197326808854023],
  translation: [-19806.93688973067, -3894.915166728017, -10.247193580757845],
};

function file(systems: TdppCoordSystem[]): TdppFile {
  return {
    header: { origin: [100, 200, 5] },
    nodes: [{ index: 0 }],
    meta: {
      frame: 'test',
      axes: null,
      rotation: null,
      coordinateSystems: systems,
      setups: [
        { name: 'a', rotation: [1, 0, 0, 0], translation: [-18.447, -0.045, -0.026], sphere: null },
        { name: 'b', rotation: [1, 0, 0, 0], translation: [90, 210, 6.5], sphere: null },
      ],
    },
  } as unknown as TdppFile;
}

describe('scan placement', () => {
  it('returns the stored file itself for no change', () => {
    const f = file([]);
    expect(placeTdpp(f, { offset: [0, 0, 0] })).toBe(f);
    expect(placeTdpp(f, { system: SOURCE_FRAME, offset: [0, 0, 0] })).toBe(f);
  });

  it('moves the origin and every setup by the offset, leaving the stored file and the nodes alone', () => {
    const f = file([]);
    const moved = placeTdpp(f, { offset: [10, -20, 0.5] });
    expect(moved.header.origin).toEqual([110, 180, 5.5]);
    expect(moved.meta.setups[1].translation).toEqual([100, 190, 7]);
    expect(moved.nodes).toBe(f.nodes);
    expect(f.header.origin).toEqual([100, 200, 5]);
  });

  it('shows a file written in the project frame in its survey-control system', () => {
    const f = file([CONTROL]);
    expect(fileSystemName(f)).toBe(SOURCE_FRAME);
    const placed = placeTdpp(f, { system: 'Control', offset: [0, 0, 0] });
    // the setup the project's applied-control record puts at these site coordinates
    const s = placed.meta.setups[0].translation;
    expect(s[0]).toBeCloseTo(19499.09, 1);
    expect(s[1]).toBeCloseTo(5151.67, 1);
    expect(s[2]).toBeCloseTo(13.0, 1);
    // a stored point (origin + axes · local) lands where the transform puts it
    const local = [3, 4, 5] as const;
    const viaAxes = toScene(placed.meta.axes, local).map((v, k) => v + placed.header.origin[k]);
    const direct = poseApply(placementPose(f, 'Control'), [103, 204, 10]);
    for (let k = 0; k < 3; k++) {
      expect(viaAxes[k]).toBeCloseTo(direct[k], 6);
    }
    expect(placed.meta.frame).toContain('Control');
  });

  it('goes back to the project frame from a file written in a coordinate system', () => {
    const projectFile = file([CONTROL]);
    const inControl = placeTdpp(projectFile, { system: 'Control', offset: [0, 0, 0] });
    // the same content as a cook in the Control system would write it
    const cooked = {
      ...inControl,
      meta: { ...inControl.meta, coordinateSystems: [{ ...CONTROL, used: true }] },
    };
    expect(fileSystemName(cooked)).toBe('Control');
    expect(placeTdpp(cooked, { offset: [0, 0, 0] })).toBe(cooked);
    const back = placeTdpp(cooked, { system: SOURCE_FRAME, offset: [0, 0, 0] });
    for (let k = 0; k < 3; k++) {
      expect(back.header.origin[k]).toBeCloseTo(projectFile.header.origin[k], 6);
      expect(back.meta.setups[0].translation[k]).toBeCloseTo(-[18.447, 0.045, 0.026][k], 6);
    }
    const x = toScene(back.meta.axes, [1, 0, 0]);
    expect(x[0]).toBeCloseTo(1, 9);
    expect(x[1]).toBeCloseTo(0, 9);
  });
});
