// The CPU visibility tests the residency manager relies on: frustum culling
// for zones with no resident geometry, and clipCull.ts — a hand-port of the
// cull shader's `clip_culled` (shaders/cull.ts). A wrong answer here does not
// draw anything wrong; it silently makes the budget load or evict the wrong
// zones, so the semantics are pinned here.
import { describe, expect, it } from 'vitest';
import { boxFullyInFrustum, boxInFrustum } from '../src/lib/math/frustum';
import { clipCulledSphere } from '../src/lib/render/clipCull';

// -----------------------------------------------------------------------------
// a simple perspective view-projection looking down -Z from the origin
// -----------------------------------------------------------------------------

/** Column-major perspective matrix (WebGPU depth range 0..1). */
function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

const VP = perspective(Math.PI / 3, 1, 0.1, 1000);

/** Axis-aligned box centred at (x, y, z) with half-extent h. */
const box = (x: number, y: number, z: number, h = 1): number[] => [x - h, y - h, z - h, x + h, y + h, z + h];

describe('boxInFrustum', () => {
  it('accepts a box straight ahead', () => {
    expect(boxInFrustum(VP, box(0, 0, -10))).toBe(true);
  });

  it('rejects a box behind the camera', () => {
    expect(boxInFrustum(VP, box(0, 0, 10))).toBe(false);
  });

  it('rejects boxes far off to each side', () => {
    expect(boxInFrustum(VP, box(500, 0, -10))).toBe(false);
    expect(boxInFrustum(VP, box(-500, 0, -10))).toBe(false);
    expect(boxInFrustum(VP, box(0, 500, -10))).toBe(false);
    expect(boxInFrustum(VP, box(0, -500, -10))).toBe(false);
  });

  it('rejects a box beyond the far plane', () => {
    expect(boxInFrustum(VP, box(0, 0, -5000))).toBe(false);
  });

  it('accepts a box straddling the view edge (conservative)', () => {
    // centred outside the right edge but large enough to reach into view
    expect(boxInFrustum(VP, box(12, 0, -10, 8))).toBe(true);
  });

  it('accepts a box enclosing the camera', () => {
    expect(boxInFrustum(VP, box(0, 0, 0, 50))).toBe(true);
  });

  it('reads a box at an offset inside a larger array', () => {
    const many = new Float32Array([...box(0, 0, 10), ...box(0, 0, -10)]);
    expect(boxInFrustum(VP, many, 0)).toBe(false);
    expect(boxInFrustum(VP, many, 6)).toBe(true);
  });
});

describe('boxFullyInFrustum', () => {
  it('is true only when every corner is inside', () => {
    expect(boxFullyInFrustum(VP, box(0, 0, -50, 1))).toBe(true);
    expect(boxFullyInFrustum(VP, box(12, 0, -10, 8))).toBe(false); // straddles
    expect(boxFullyInFrustum(VP, box(0, 0, 10))).toBe(false); // behind
  });

  it('implies boxInFrustum (fully inside ⇒ intersecting)', () => {
    for (const b of [box(0, 0, -50), box(2, -3, -80), box(0, 0, -20, 3)]) {
      if (boxFullyInFrustum(VP, b)) {
        expect(boxInFrustum(VP, b)).toBe(true);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// ClipData (clipPack.ts layout): planes[8]×vec4 @0, plane_mask @32,
// then 8 shapes × 28 floats: inv_transform mat4 @+0, params0 @+16,
// params1 @+20, kind_flags @+24 (kind, isHole, …)
// -----------------------------------------------------------------------------

const SHAPES = 36;
const STRIDE = 28;

function makeClip(): { f: Float32Array; u: Uint32Array } {
  const f = new Float32Array(260);
  const u = new Uint32Array(f.buffer);
  return { f, u };
}

/** Enable clip plane `i` with normal n and offset d (keeps dot(n,p)+d ≥ 0). */
function setPlane(c: { f: Float32Array; u: Uint32Array }, i: number, n: [number, number, number], d: number) {
  c.f.set([...n, d], i * 4);
  c.u[32] |= 1 << i;
}

/** Axis-aligned box shape in slot `si` (identity transform). kind 1 = box. */
function setBoxShape(
  c: { f: Float32Array; u: Uint32Array },
  si: number,
  min: [number, number, number],
  max: [number, number, number],
  hole: boolean,
) {
  const s = SHAPES + si * STRIDE;
  c.f[s] = 1;
  c.f[s + 5] = 1;
  c.f[s + 10] = 1;
  c.f[s + 15] = 1; // identity inv_transform
  c.f.set(min, s + 16);
  c.f.set(max, s + 20);
  c.u[s + 24] = 1; // kind: box
  c.u[s + 25] = hole ? 1 : 0;
}

/** Sphere shape (kind 2): params0 = centre + radius. */
function setSphereShape(
  c: { f: Float32Array; u: Uint32Array },
  si: number,
  centre: [number, number, number],
  radius: number,
  hole: boolean,
) {
  const s = SHAPES + si * STRIDE;
  c.f[s] = 1;
  c.f[s + 5] = 1;
  c.f[s + 10] = 1;
  c.f[s + 15] = 1;
  c.f.set([...centre, radius], s + 16);
  c.u[s + 24] = 2;
  c.u[s + 25] = hole ? 1 : 0;
}

describe('clipCulledSphere — planes', () => {
  it('passes everything when no plane is enabled', () => {
    const c = makeClip();
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1)).toBe(false);
  });

  it('culls a sphere entirely behind an enabled plane', () => {
    const c = makeClip();
    setPlane(c, 0, [1, 0, 0], 0); // keep x ≥ 0
    expect(clipCulledSphere(c.f, c.u, [-10, 0, 0], 1)).toBe(true);
  });

  it('keeps a sphere on the kept side, and one merely touching the plane', () => {
    const c = makeClip();
    setPlane(c, 0, [1, 0, 0], 0);
    expect(clipCulledSphere(c.f, c.u, [10, 0, 0], 1)).toBe(false);
    expect(clipCulledSphere(c.f, c.u, [-0.5, 0, 0], 1)).toBe(false); // straddles
  });

  it('ignores a plane whose mask bit is clear', () => {
    const c = makeClip();
    c.f.set([1, 0, 0, 0], 0); // written but not enabled
    expect(clipCulledSphere(c.f, c.u, [-10, 0, 0], 1)).toBe(false);
  });
});

describe('clipCulledSphere — keep volumes', () => {
  it('culls a sphere entirely outside the keep box', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-5, -5, -5], [5, 5, 5], false);
    expect(clipCulledSphere(c.f, c.u, [100, 0, 0], 1)).toBe(true);
  });

  it('keeps a sphere inside, and one straddling the boundary', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-5, -5, -5], [5, 5, 5], false);
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1)).toBe(false);
    expect(clipCulledSphere(c.f, c.u, [5.5, 0, 0], 1)).toBe(false);
  });

  it('treats multiple keeps as a UNION (inside any one survives)', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-5, -5, -5], [5, 5, 5], false);
    setBoxShape(c, 1, [95, -5, -5], [105, 5, 5], false);
    expect(clipCulledSphere(c.f, c.u, [100, 0, 0], 1)).toBe(false); // in the 2nd
    expect(clipCulledSphere(c.f, c.u, [50, 0, 0], 1)).toBe(true); // in neither
  });

  it('supports a sphere keep volume', () => {
    const c = makeClip();
    setSphereShape(c, 0, [0, 0, 0], 10, false);
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1)).toBe(false);
    expect(clipCulledSphere(c.f, c.u, [100, 0, 0], 1)).toBe(true);
  });
});

describe('clipCulledSphere — holes', () => {
  it('culls a sphere entirely inside a hole', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-50, -50, -50], [50, 50, 50], true);
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1)).toBe(true);
  });

  it('keeps a sphere straddling the hole boundary, or outside it', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-50, -50, -50], [50, 50, 50], true);
    expect(clipCulledSphere(c.f, c.u, [49.5, 0, 0], 1)).toBe(false); // straddles
    expect(clipCulledSphere(c.f, c.u, [100, 0, 0], 1)).toBe(false); // outside
  });

  it('supports a sphere hole', () => {
    const c = makeClip();
    setSphereShape(c, 0, [0, 0, 0], 50, true);
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1)).toBe(true);
    expect(clipCulledSphere(c.f, c.u, [100, 0, 0], 1)).toBe(false);
  });

  it('a hole does not make everything else a keep volume', () => {
    // holes must not set any_keep — otherwise a lone hole would cull the
    // entire scene outside it
    const c = makeClip();
    setBoxShape(c, 0, [-5, -5, -5], [5, 5, 5], true);
    expect(clipCulledSphere(c.f, c.u, [1000, 0, 0], 1)).toBe(false);
  });
});

describe('clipCulledSphere — combined', () => {
  it('a plane still culls inside a keep volume', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-50, -50, -50], [50, 50, 50], false);
    setPlane(c, 0, [1, 0, 0], 0);
    expect(clipCulledSphere(c.f, c.u, [-20, 0, 0], 1)).toBe(true);
    expect(clipCulledSphere(c.f, c.u, [20, 0, 0], 1)).toBe(false);
  });

  it('a hole inside a keep volume still carves', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-50, -50, -50], [50, 50, 50], false);
    setBoxShape(c, 1, [-10, -10, -10], [10, 10, 10], true);
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1)).toBe(true); // in the hole
    expect(clipCulledSphere(c.f, c.u, [30, 0, 0], 1)).toBe(false); // keep only
  });

  it('is conservative for a huge sphere (never culls what might show)', () => {
    const c = makeClip();
    setBoxShape(c, 0, [-5, -5, -5], [5, 5, 5], true); // small hole
    expect(clipCulledSphere(c.f, c.u, [0, 0, 0], 1000)).toBe(false);
  });
});
