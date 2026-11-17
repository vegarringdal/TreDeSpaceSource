import { describe, expect, it } from 'vitest';
import {
  decomposeRigid,
  interpEase,
  lerpCamera,
  m4InvertRigid,
  m4Multiply,
  m4TransformPoint,
  poseMatrix,
  qAngleDeg,
  qAxisAngle,
  qFromEulerDeg,
  qToEulerDeg,
  sampleTransform,
} from '../src/lib/animation/interp';
import type { Quat, V3 } from '../src/lib/animation/types';
import { key } from './helpers/animDoc';

const close = (a: readonly number[], b: readonly number[], eps = 1e-5) =>
  a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(eps));

/** q and −q are the same rotation. */
const sameRot = (a: Quat, b: Quat) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  expect(1 - d).toBeLessThan(1e-6);
};

describe('interpolation', () => {
  it('maps the ends exactly and clamps', () => {
    for (const k of ['linear', 'smooth'] as const) {
      expect(interpEase(k, 0)).toBe(0);
      expect(interpEase(k, 1)).toBe(1);
      expect(interpEase(k, 2)).toBe(1);
      expect(interpEase(k, -1)).toBe(0);
    }
    expect(interpEase('hold', 0.99)).toBe(0);
    expect(interpEase('hold', 1)).toBe(1);
    expect(interpEase('smooth', 0.5)).toBeCloseTo(0.5);
    expect(interpEase('smooth', 0.25)).toBeLessThan(0.25);
  });
});

describe('poseMatrix / decomposeRigid', () => {
  it('rotates about the pivot, which stays put', () => {
    const pivot: V3 = [2, 3, 4];
    const m = poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([0, 0, 1], 90) }, pivot);
    close(m4TransformPoint(m, pivot), pivot);
    close(m4TransformPoint(m, [3, 3, 4]), [2, 4, 4]);
  });

  it('round-trips move / rotate through the matrix', () => {
    const pivot: V3 = [1, -2, 0.5];
    const rotate = qFromEulerDeg([10, 20, 30]);
    const move: V3 = [0.3, -1, 2];
    const back = decomposeRigid(poseMatrix({ move, rotate }, pivot), pivot);
    close(back.move, move);
    sameRot(back.rotate, rotate);
  });

  it('folds a world-space gizmo drag into a key (D′ = G · D)', () => {
    const pivot: V3 = [5, 0, 0];
    const D = poseMatrix({ move: [0, 0, 1], rotate: qAxisAngle([0, 0, 1], 45) }, pivot);
    const G = poseMatrix({ move: [2, 0, 0], rotate: qAxisAngle([1, 0, 0], 30) }, [5, 0, 1]);
    const folded = m4Multiply(G, D);
    const k = decomposeRigid(folded, pivot);
    const re = poseMatrix(k, pivot);
    for (const p of [pivot, [0, 0, 0] as V3, [1, 2, 3] as V3]) {
      close(m4TransformPoint(re, p), m4TransformPoint(folded, p), 1e-4);
    }
  });

  it('inverts rigid matrices', () => {
    const m = poseMatrix({ move: [1, 2, 3], rotate: qFromEulerDeg([5, 50, -20]) }, [1, 1, 1]);
    const id = m4Multiply(m, m4InvertRigid(m));
    close(id, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-5);
  });
});

describe('euler helpers', () => {
  it('round-trip within gimbal-safe ranges', () => {
    const e: V3 = [12, -34, 56];
    close(qToEulerDeg(qFromEulerDeg(e)), e, 1e-3);
  });
});

describe('sampleTransform', () => {
  it('clamps before/after and interpolates between keys', () => {
    const keys = [key(1, [0, 0, 0]), key(3, [2, 0, 0])];
    close(sampleTransform(keys, 0).move, [0, 0, 0]);
    close(sampleTransform(keys, 2).move, [1, 0, 0]);
    close(sampleTransform(keys, 9).move, [2, 0, 0]);
  });

  it('slerps the short way', () => {
    const keys = [key(0), key(1, [0, 0, 0], { rotate: qAxisAngle([0, 0, 1], 90) })];
    expect(qAngleDeg(sampleTransform(keys, 0.5).rotate)).toBeCloseTo(45, 3);
  });

  it('spins beyond 180° and lands on the key', () => {
    const keys = [key(0), key(1, [0, 0, 0], { spin: { axis: [0, 0, 1], degrees: 720 } })];
    // a quarter of the way through two turns = 180°
    const q = sampleTransform(keys, 0.25).rotate;
    expect(qAngleDeg(q)).toBeCloseTo(180, 2);
    sameRot(sampleTransform(keys, 1).rotate, [0, 0, 0, 1]);
    // three-quarter turn at 3/8
    const p = m4TransformPoint(poseMatrix({ move: [0, 0, 0], rotate: sampleTransform(keys, 3 / 8).rotate }, [0, 0, 0]), [1, 0, 0]);
    close(p, [0, -1, 0], 1e-5);
  });

  it('spin onto a non-identity end rotation stays continuous', () => {
    const end = qAxisAngle([0, 0, 1], 90);
    const keys = [key(0), key(1, [0, 0, 0], { rotate: end, spin: { axis: [0, 0, 1], degrees: 450 } })];
    sameRot(sampleTransform(keys, 1).rotate, end);
    sameRot(sampleTransform(keys, 0).rotate, [0, 0, 0, 1]);
  });
});

describe('camera', () => {
  it('lerps the camera the short way and log-lerps distance', () => {
    const a = { target: [0, 0, 0] as V3, azimuth: 3, elevation: 0, orbitDistance: 1, orthographic: false };
    const b = { target: [2, 0, 0] as V3, azimuth: -3, elevation: 1, orbitDistance: 100, orthographic: true };
    const m = lerpCamera(a, b, 0.5);
    expect(m.orbitDistance).toBeCloseTo(10);
    expect(Math.abs(m.azimuth - Math.PI)).toBeLessThan(0.01);
    expect(m.orthographic).toBe(false);
    expect(lerpCamera(a, b, 1).orthographic).toBe(true);
  });
});
