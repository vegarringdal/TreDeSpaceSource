// Column-major mat4 helpers (matches glam / WGSL mat4x4f layout). Shared by
// the worker's transform bake and the main-thread gizmo's live group matrix.

export type M4 = Float32Array;

export function m4Identity(): M4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** out = a * b */
export function m4Mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function m4Translate(x: number, y: number, z: number): M4 {
  const m = m4Identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** Rotation about a world unit axis (Rodrigues), angle in radians. */
export function m4AxisRotate(a: [number, number, number], rad: number): M4 {
  const [x, y, z] = a;
  const c = Math.cos(rad),
    s = Math.sin(rad),
    t = 1 - c;
  const m = m4Identity();
  m[0] = t * x * x + c;
  m[4] = t * x * y - s * z;
  m[8] = t * x * z + s * y;
  m[1] = t * x * y + s * z;
  m[5] = t * y * y + c;
  m[9] = t * y * z - s * x;
  m[2] = t * x * z - s * y;
  m[6] = t * y * z + s * x;
  m[10] = t * z * z + c;
  return m;
}

/** Scale by factor f along a world unit axis: I + (f-1)·aaᵀ. */
export function m4AxisScale(a: [number, number, number], f: number): M4 {
  const [x, y, z] = a;
  const k = f - 1;
  const m = m4Identity();
  m[0] += k * x * x;
  m[4] += k * x * y;
  m[8] += k * x * z;
  m[1] += k * y * x;
  m[5] += k * y * y;
  m[9] += k * y * z;
  m[2] += k * z * x;
  m[6] += k * z * y;
  m[10] += k * z * z;
  return m;
}

/** Transform `local` (rotate/scale about origin) into one about `c`. */
export function m4AboutPoint(local: M4, c: [number, number, number]): M4 {
  return m4Mul(m4Translate(c[0], c[1], c[2]), m4Mul(local, m4Translate(-c[0], -c[1], -c[2])));
}
