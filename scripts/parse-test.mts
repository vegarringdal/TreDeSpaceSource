// Node smoke test: parse a real cooked .tdp and sanity-check geometry.
// Usage: node scripts/parse-test.mts <path-to.tdp>
import { readFileSync } from "node:fs";
import { parseModel } from "../src/lib/model/format.ts";

const path = process.argv[2];
const bytes = readFileSync(path);
const model = await parseModel(
  path,
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

console.log(`bounds ${model.boundsMin} .. ${model.boundsMax}`);
console.log(`color groups: ${model.colorGroups.length}`);

let meshlets = 0, tris = 0, verts = 0, bad = 0;
const eps = 1e-3;
for (const cg of model.colorGroups) {
  meshlets += cg.meshletCount;
  verts += cg.localVertCount;
  for (let m = 0; m < cg.meshletCount; m++) {
    const d = m * 40;
    const vOff = cg.descs.getUint32(d, true);
    const tOff = cg.descs.getUint32(d + 4, true);
    const vCount = cg.descs.getUint32(d + 8, true);
    const tCount = cg.descs.getUint32(d + 12, true);
    tris += tCount;
    if (vCount > 64 || tCount > 124) bad++;
    // micro-indices must be < vCount
    for (let t = 0; t < tCount * 3; t++) {
      if (cg.tris[tOff + t] >= vCount) { bad++; break; }
    }
    // dequantized positions must land inside the model AABB (with slack)
    const mn = [16, 20, 24].map((o) => cg.descs.getFloat32(d + o, true));
    const sc = [28, 32, 36].map((o) => cg.descs.getFloat32(d + o, true));
    for (let v = 0; v < vCount; v++) {
      for (let a = 0; a < 3; a++) {
        const q = cg.positions[(vOff + v) * 6 + a * 2] | (cg.positions[(vOff + v) * 6 + a * 2 + 1] << 8);
        const p = mn[a] + q * sc[a];
        const ext = model.boundsMax[a] - model.boundsMin[a];
        if (p < model.boundsMin[a] - eps - ext * 0.01 || p > model.boundsMax[a] + eps + ext * 0.01) {
          bad++; v = vCount; break;
        }
      }
    }
    // bounding sphere center inside AABB-ish
    const b = m * 12;
    if (!Number.isFinite(cg.bounds[b]) || cg.bounds[b + 3] < 0) bad++;
  }
  if (cg.normals) {
    if (cg.normals.length !== cg.localVertCount * 4) bad++;
  }
}
console.log(`meshlets ${meshlets}, tris ${tris}, local verts ${verts}, normals: ${model.colorGroups[0]?.normals ? "yes" : "no"}`);
console.log(bad === 0 ? "OK — all sanity checks passed" : `FAILED — ${bad} bad checks`);
process.exit(bad === 0 ? 0 : 1);
