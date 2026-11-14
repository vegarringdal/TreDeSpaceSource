// Where a scan sits in the scene: the coordinate system it is shown in and
// the user's offset on top. A `.tdpp` is written in one coordinate system of
// its source (TdppCoordSystem.used — or the source's own frame) and lists the
// others; because the points are stored relative to the header origin along
// fixed axes, another system is only a different origin, axes rotation and
// set of setup poses — nothing is re-read or converted.
import { axesOfQuat } from './cloudFrame';
import type { Quat, TdppFile, Vec3 } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Rigid transform p' = R·p + t, R as a unit quaternion [w, x, y, z]. */
export interface Pose {
  readonly rotation: Quat;
  readonly translation: Vec3;
}

export interface ScanPlacement {
  /** Name of the coordinate system to show the scan in; '' = the source's
   *  own frame (no coordinate system); undefined = the one the file is in. */
  readonly system?: string;
  /** Added on top, metres. */
  readonly offset: Vec3;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const POSE_IDENTITY: Pose = { rotation: [1, 0, 0, 0], translation: [0, 0, 0] };
/** `ScanPlacement.system` for the source's own frame. */
export const SOURCE_FRAME = '';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, [0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
  return [p[1], p[2], p[3]];
}

export function poseApply(p: Pose, v: Vec3): Vec3 {
  const r = rotate(p.rotation, v);
  return [r[0] + p.translation[0], r[1] + p.translation[1], r[2] + p.translation[2]];
}

/** `a ∘ b`: apply `b` first, then `a`. */
export function poseCompose(a: Pose, b: Pose): Pose {
  return { rotation: quatMul(a.rotation, b.rotation), translation: poseApply(a, b.translation) };
}

export function poseInverse(p: Pose): Pose {
  const rotation: Quat = [p.rotation[0], -p.rotation[1], -p.rotation[2], -p.rotation[3]];
  const t = rotate(rotation, p.translation);
  return { rotation, translation: [-t[0], -t[1], -t[2]] };
}

/** The coordinate system `placement` names, as the file lists it; null for
 *  the source's own frame, or when the file has no such system. */
function systemPose(file: TdppFile, name: string): Pose | null {
  const c = name === SOURCE_FRAME ? undefined : file.meta.coordinateSystems.find((s) => s.name === name);
  return c ? { rotation: c.rotation, translation: c.translation } : null;
}

/** The name of the coordinate system the file itself is in ('' = the source's own frame). */
export function fileSystemName(file: TdppFile): string {
  return file.meta.coordinateSystems.find((s) => s.used)?.name ?? SOURCE_FRAME;
}

/**
 * The transform from the coordinates the file is in to those of
 * `placement.system`. A system's pose maps its coordinates to the source
 * frame, so going from system A to system B is `B⁻¹ ∘ A` (identity poses for
 * the source frame itself).
 */
export function placementPose(file: TdppFile, system: string | undefined): Pose {
  const from = fileSystemName(file);
  if (system === undefined || system === from) {
    return POSE_IDENTITY;
  }
  const a = systemPose(file, from) ?? POSE_IDENTITY;
  const b = systemPose(file, system) ?? POSE_IDENTITY;
  return poseCompose(poseInverse(b), a);
}

/**
 * `file` as placed: shown in `placement.system` and moved by the offset. The
 * header origin, the axes rotation, the setup poses and absolute panorama
 * rotations change; nodes and payloads are shared with `file`.
 */
export function placeTdpp(file: TdppFile, placement: ScanPlacement): TdppFile {
  const t = placementPose(file, placement.system);
  const o = placement.offset;
  if (t === POSE_IDENTITY && o[0] === 0 && o[1] === 0 && o[2] === 0) {
    return file;
  }
  const move = (p: Vec3): Vec3 => {
    const q = poseApply(t, p);
    return [q[0] + o[0], q[1] + o[1], q[2] + o[2]];
  };
  const rotation = t === POSE_IDENTITY ? file.meta.rotation : quatMul(t.rotation, file.meta.rotation ?? [1, 0, 0, 0]);
  const system = placement.system ?? fileSystemName(file);
  return {
    ...file,
    header: { ...file.header, origin: move(file.header.origin) },
    meta: {
      ...file.meta,
      frame:
        t === POSE_IDENTITY
          ? file.meta.frame
          : system === SOURCE_FRAME
            ? 'source frame'
            : `coordinate system "${system}"`,
      rotation,
      axes: rotation ? axesOfQuat(rotation) : null,
      setups: file.meta.setups.map((s) => ({
        ...s,
        rotation: quatMul(t.rotation, s.rotation),
        translation: move(s.translation),
        sphere: s.sphere ? { ...s.sphere, rotation: quatMul(t.rotation, s.sphere.rotation) } : null,
      })),
    },
  };
}
