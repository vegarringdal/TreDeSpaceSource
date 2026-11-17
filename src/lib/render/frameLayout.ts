// Layout of the shared Frame uniform (`struct Frame` in shaders/scene.ts).
//
// Several passes take the frame the main draw built and patch a few fields for
// their own slot (pick @512, outline mask @768), so the byte size and the slot
// indices live HERE rather than as magic numbers in each pass. Adding `origin`
// for camera-relative rendering shifted everything after it and broke picking
// and outlines precisely because those numbers were duplicated.

/** Bytes in one Frame slot — also the bind layout's `minBindingSize`. */
export const FRAME_SIZE = 192;

/** Index of each member in a Float32Array/Uint32Array view over a Frame. */
export const FRAME_SLOT = {
  /** mat4x4f, camera-relative: clip = view_proj * (world - origin) */
  viewProj: 0,
  /** vec4f — xyz = the frame's rebase origin */
  origin: 16,
  /** origin.w — unlit luma a pure-black material colour is rendered at
   *  (Settings → Rendering → Dark colours); 0 = off */
  darkFloor: 19,
  /** vec4f — eye in rebased space */
  eye: 20,
  /** vec4u — x: meshlet debug, y: suppress tint, z: blend routing, w: AA seed */
  flags: 24,
  /** vec4f — xyz: directional headlight, w: 1 = ortho */
  light: 28,
  /** vec4f — rgb ambient + intensity; the pick/outline passes reuse xy */
  ambient: 32,
  /** vec4f — rgb headlight color + intensity */
  headlight: 36,
  /** vec4f — selection highlight rgb + blend amount */
  selColor: 40,
  /** vec4f — rgb: canvas background; w: Background-mode fade amount, how far
   *  a backdrop item's colour moves toward the canvas (0 = its own colour) */
  backdrop: 44,
} as const;
