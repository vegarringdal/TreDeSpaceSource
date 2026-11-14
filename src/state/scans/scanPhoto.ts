// The photo of the entered scan setup: loads it at a base resolution when
// the setup is entered, then sharpens what the camera looks at once the view
// is zoomed in far enough that the base would blur — single cube faces (at
// most a few at once, the least recently viewed going back to base) or the
// whole spherical image. Decoding is the browser's (createImageBitmap from a
// byte range of the .tdpp); the textures live in the renderer's photo pass.
import { facePxNeeded, facesInView, sphereSpan } from '../../lib/render/panoMath';
import type { Renderer } from '../../lib/render/renderer';
import type { TdppPanoramaLevel, TdppSetup } from '../../lib/tdpp/tdppFormat';
import type { OpenScan } from './scanFiles';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Shown {
  readonly scan: OpenScan;
  readonly setup: TdppSetup;
  /** Uploaded width per cube face, or [width] of the sphere. */
  readonly sizes: number[];
  /** Tick each face was last in view. */
  readonly seen: number[];
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const FACE_COUNT = 6;
/** Face width every face gets on entering (6 × 1536² RGBA ≈ 57 MB of VRAM). */
const BASE_FACE_PX = 1536;
/** Face width of a sharpened face (4096² RGBA = 64 MB each). */
const SHARP_FACE_PX = 4096;
/** Sharpened faces kept at once. */
const MAX_SHARP_FACES = 3;
const BASE_SPHERE_PX = 4096;
const SHARP_SPHERE_PX = 8192;
/** Sharpen once the screen needs this many times the uploaded resolution. */
const SHARPEN_AT = 1.4;

let shown: Shown | null = null;
let token = 0;
let tickNo = 0;
let busy = false;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Decode one stored level scaled to `width` px wide (never upscaled): the
 *  smallest level that is at least that wide, else the largest there is. */
async function decode(scan: OpenScan, levels: readonly TdppPanoramaLevel[], width: number): Promise<ImageBitmap> {
  const fits = levels.filter((l) => l.width >= width).sort((a, b) => a.width - b.width)[0];
  const level = fits ?? [...levels].sort((a, b) => b.width - a.width)[0];
  if (!level) {
    throw new Error('the photo has no image');
  }
  const bytes = await scan.src.read(level.offset, level.size);
  const w = Math.min(level.width, width);
  return createImageBitmap(new Blob([bytes], { type: level.format === 'png' ? 'image/png' : 'image/jpeg' }), {
    resizeWidth: w,
    resizeHeight: Math.max(1, Math.round((level.height * w) / level.width)),
    resizeQuality: 'high',
  });
}

const widest = (levels: readonly TdppPanoramaLevel[]) => levels.reduce((m, l) => Math.max(m, l.width), 0);

/** Swap one cube face for a `width` px version (async; one swap at a time). */
async function swapFace(r: Renderer, s: Shown, face: number, width: number) {
  busy = true;
  try {
    const img = await decode(s.scan, s.setup.faces?.[face]?.levels ?? [], width);
    if (shown === s) {
      r.photo.setFace(face, img);
      s.sizes[face] = img.width;
    }
    img.close();
  } catch {
    s.sizes[face] = Number.POSITIVE_INFINITY; // unreadable level: stop retrying this face
  } finally {
    busy = false;
  }
}

async function sharpenSphere(r: Renderer, s: Shown, width: number) {
  const sphere = s.setup.sphere;
  if (!sphere) {
    return;
  }
  busy = true;
  try {
    const img = await decode(s.scan, sphere.levels, width);
    if (shown === s) {
      r.photo.setSphere(img, ...spanOf(sphere));
      s.sizes[0] = img.width;
    }
    img.close();
  } catch {
    s.sizes[0] = Number.POSITIVE_INFINITY;
  } finally {
    busy = false;
  }
}

/** Azimuth and elevation a setup's spherical image covers (the stored pixel
 *  size is for the full-resolution level). */
function spanOf(sphere: NonNullable<TdppSetup['sphere']>): [number, number] {
  const full = [...sphere.levels].sort((x, y) => y.width - x.width)[0];
  return full ? sphereSpan(sphere.pixelWidth, sphere.pixelHeight, full.width, full.height) : [0, 0];
}

/** Cube photo: sharpen the most needed face in view, or give back the least
 *  recently viewed sharp face when too many are held. */
function tickCube(r: Renderer, s: Shown, canvas: HTMLCanvasElement) {
  const cam = r.camera;
  const tanY = Math.tan(cam.fovY / 2);
  const rotation = s.setup.rotation;
  const inView = facesInView(cam.forward(), (tanY * canvas.width) / canvas.height, tanY, rotation);
  for (const f of inView) {
    s.seen[f] = tickNo;
  }
  const need = facePxNeeded(canvas.height, cam.fovY);
  const cap = Math.min(SHARP_FACE_PX, r.photo.maxTextureSize);
  for (const f of inView) {
    const best = Math.min(cap, widest(s.setup.faces?.[f]?.levels ?? []));
    if (need > s.sizes[f] * SHARPEN_AT && best > s.sizes[f]) {
      void swapFace(r, s, f, best);
      return;
    }
  }
  const sharp = [...Array(FACE_COUNT).keys()].filter((f) => s.sizes[f] > BASE_FACE_PX && Number.isFinite(s.sizes[f]));
  if (sharp.length > MAX_SHARP_FACES) {
    const oldest = sharp.filter((f) => !inView.has(f)).sort((a, b) => s.seen[a] - s.seen[b])[0];
    if (oldest !== undefined) {
      void swapFace(r, s, oldest, BASE_FACE_PX);
    }
  }
}

function tickSphere(r: Renderer, s: Shown, canvas: HTMLCanvasElement) {
  const sphere = s.setup.sphere;
  if (!sphere) {
    return;
  }
  const full = widest(sphere.levels);
  const need = (canvas.height / r.camera.fovY) * spanOf(sphere)[0];
  const best = Math.min(SHARP_SPHERE_PX, r.photo.maxTextureSize, full);
  if (need > s.sizes[0] * SHARPEN_AT && best > s.sizes[0]) {
    void sharpenSphere(r, s, best);
  }
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export const scanPhoto = {
  /** Load and show a setup's photo at base resolution (nothing when it has
   *  none). Throws when the image cannot be read or decoded. */
  async show(r: Renderer, scan: OpenScan, setup: TdppSetup): Promise<void> {
    const mine = ++token;
    shown = null;
    if (setup.faces) {
      const images: ImageBitmap[] = [];
      for (let face = 0; face < FACE_COUNT; face++) {
        images.push(await decode(scan, setup.faces[face]?.levels ?? [], BASE_FACE_PX));
      }
      if (mine !== token) {
        for (const img of images) {
          img.close();
        }
        return;
      }
      r.photo.clearPhoto();
      images.forEach((img, face) => {
        r.photo.setFace(face, img);
      });
      shown = { scan, setup, sizes: images.map((i) => i.width), seen: images.map(() => 0) };
      for (const img of images) {
        img.close();
      }
      return;
    }
    if (setup.sphere) {
      const width = Math.min(BASE_SPHERE_PX, r.photo.maxTextureSize);
      const img = await decode(scan, setup.sphere.levels, width);
      if (mine !== token) {
        img.close();
        return;
      }
      r.photo.setSphere(img, ...spanOf(setup.sphere));
      shown = { scan, setup, sizes: [img.width], seen: [0] };
      img.close();
      return;
    }
    r.photo.clearPhoto();
  },

  /** Drop the photo (leaving the setup, closing the scan). */
  clear(r: Renderer | null) {
    token++;
    shown = null;
    r?.photo.clearPhoto();
  },

  /** Per viewport frame: sharpen what the zoomed-in view looks at. */
  tick(r: Renderer) {
    const s = shown;
    const canvas = r.canvasEl;
    if (!s || busy || !canvas || canvas.height === 0 || r.camera.ortho) {
      return;
    }
    tickNo++;
    if (s.setup.faces) {
      tickCube(r, s, canvas);
    } else {
      tickSphere(r, s, canvas);
    }
  },
};
