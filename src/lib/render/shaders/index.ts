// All WGSL for the renderer, one module per pass family. Shader text is
// pinned by tests/shaders.pin.test.ts — regenerate snapshots on intentional
// shader changes.
export { cullWgsl, hzbWgsl, sortScanWgsl, sortScatterWgsl } from './cull';
export { markerWgsl } from './marker';
export { panoWgsl } from './pano';
export { pickDepthWgsl, pickItemIdWgsl } from './pick';
export { POINT_HEADER_WORDS, POINT_WORDS, pointsWgsl } from './points';
export { outlineWgsl, postWgsl, vbaoWgsl } from './post';
export { lineWgsl, renderVpWgsl, renderWgsl } from './scene';
export { measureSnapWgsl } from './snap';
export { cubeBlitWgsl, viewCubeWgsl } from './viewCube';
