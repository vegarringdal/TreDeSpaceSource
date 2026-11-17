// Pure math of the scan photo view (panoPass.ts draws with it, the photo
// manager in state/scans/scanPhoto.ts decides which cube faces to sharpen
// with it). The face numbering is the .tdpp / LGSX one the shader uses:
// faces 0..5 look along +Y, −Y, −X, +X, +Z, −Z of the setup frame.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Screen positions (NDC) probed for the faces in view: centre, corners, edge mids. */
const PROBES = [-1, 0, 1];
/** Azimuth spans outside this range are taken as bad metadata (radians). */
const MIN_SPHERE_SPAN = 0.5;
const FULL_TURN = 2 * Math.PI;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Rows of the world → photo-frame rotation (the transpose of photo → world, [w, x, y, z]). */
export function worldToPhotoRows(q: Quat): number[][] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const [w, x, y, z] = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  const m = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  return [0, 1, 2].map((r) => [m[0][r], m[1][r], m[2][r]]);
}

/** Unit screen-right / screen-up for a view direction (Z-up world). */
export function screenBasis(f: Vec3): { right: number[]; up: number[] } {
  const rl = Math.hypot(f[0], f[1]) || 1;
  const right = [f[1] / rl, -f[0] / rl, 0];
  const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  return { right, up };
}

/** The cube face a photo-frame direction lands on (dominant axis). */
export function cubeFaceOf(d: Vec3): number {
  const [ax, ay, az] = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
  if (ax >= ay && ax >= az) {
    return d[0] > 0 ? 3 : 2;
  }
  if (ay >= az) {
    return d[1] > 0 ? 0 : 1;
  }
  return d[2] > 0 ? 4 : 5;
}

/** Cube faces the view touches: a 3 × 3 probe of the screen through the
 *  camera (good for the narrow views that ask for sharper faces). */
export function facesInView(forward: Vec3, tanX: number, tanY: number, rotation: Quat): Set<number> {
  const { right, up } = screenBasis(forward);
  const rows = worldToPhotoRows(rotation);
  const out = new Set<number>();
  for (const x of PROBES) {
    for (const y of PROBES) {
      const d = [0, 1, 2].map((k) => forward[k] + x * tanX * right[k] + y * tanY * up[k]);
      const p = rows.map((r) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]);
      out.add(cubeFaceOf([p[0], p[1], p[2]]));
    }
  }
  return out;
}

/** Texture px a 90° cube face needs to match the screen at this zoom. */
export function facePxNeeded(viewportHeight: number, fovY: number): number {
  return (viewportHeight * (Math.PI / 2)) / fovY;
}

/**
 * Azimuth and elevation a spherical image covers, radians, from its pixel
 * size (radians per pixel) and full-resolution size. Some exporters write
 * pixel sizes that make no sense (a few microradians, or more than a full
 * turn): those images are taken as a full 360° panorama with square pixels.
 */
export function sphereSpan(pixelWidth: number, pixelHeight: number, width: number, height: number): [number, number] {
  const az = pixelWidth * width;
  const el = pixelHeight * height;
  if (az >= MIN_SPHERE_SPAN && az <= FULL_TURN * 1.01 && el > 0 && el <= Math.PI * 1.01) {
    return [az, el];
  }
  return [FULL_TURN, Math.min(Math.PI, (FULL_TURN * height) / Math.max(width, 1))];
}
