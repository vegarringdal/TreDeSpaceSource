// Pins the exact WGSL text produced by every shader entry point, so the
// shaders.ts module split is provably a pure move. Regenerate snapshots only
// for intentional shader changes (npx vitest run -u).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cubeBlitWgsl,
  cullWgsl,
  hzbWgsl,
  lineWgsl,
  measureSnapWgsl,
  outlineWgsl,
  postWgsl,
  renderVpWgsl,
  renderWgsl,
  vbaoWgsl,
  viewCubeWgsl,
} from '../src/lib/render/shaders';

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('shader text pins', () => {
  it('produces byte-identical WGSL for every entry point and variant', () => {
    const hashes: Record<string, string> = {};
    for (const pass2 of [false, true]) {
      for (const vp of [false, true]) {
        hashes[`cullWgsl(${pass2},${vp})`] = sha(cullWgsl(pass2, vp));
      }
    }
    for (const msaa of [false, true]) {
      hashes[`hzbWgsl(${msaa})`] = sha(hzbWgsl(msaa));
      hashes[`vbaoWgsl(${msaa})`] = sha(vbaoWgsl(msaa));
      hashes[`postWgsl(${msaa})`] = sha(postWgsl(msaa));
      hashes[`outlineWgsl(${msaa})`] = sha(outlineWgsl(msaa));
    }
    for (const quantized of [false, true]) {
      hashes[`renderWgsl(${quantized})`] = sha(renderWgsl(quantized));
    }
    hashes['renderVpWgsl()'] = sha(renderVpWgsl());
    hashes['lineWgsl()'] = sha(lineWgsl());
    hashes['measureSnapWgsl()'] = sha(measureSnapWgsl());
    hashes['cubeBlitWgsl()'] = sha(cubeBlitWgsl());
    hashes['viewCubeWgsl()'] = sha(viewCubeWgsl());
    expect(hashes).toMatchSnapshot();
  });
});
