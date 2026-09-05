/** A unit UV sphere (z-up) for the filled marker spheres: positions double
 *  as normals, triangles wound counter-clockwise seen from outside (so back
 *  faces can be culled). `rings` latitude bands, `segments` around. */
export function unitSphereMesh(rings: number, segments: number): { positions: Float32Array; indices: Uint16Array } {
  const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
  let k = 0;
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * Math.PI * 2;
      positions[k++] = st * Math.cos(phi);
      positions[k++] = st * Math.sin(phi);
      positions[k++] = ct;
    }
  }
  const indices = new Uint16Array(rings * segments * 6);
  let n = 0;
  const at = (i: number, j: number) => i * (segments + 1) + j;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      indices[n++] = a;
      indices[n++] = b;
      indices[n++] = c;
      indices[n++] = a;
      indices[n++] = c;
      indices[n++] = d;
    }
  }
  return { positions, indices };
}
