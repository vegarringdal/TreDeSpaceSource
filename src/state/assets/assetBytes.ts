// Reading an asset's cooked bytes from its store — shared by the assets
// loader and GPU recovery so both pick the same variant.
import { modelStoreDir, readFile } from '../../lib/opfs/opfs';
import type { AssetEntry } from './assets.state';

export type AssetVariant = 'full' | 'coarse';

/** The cooked bytes of `entry`. With `coarseFirst` (a VRAM budget is active)
 *  the coarse variant is preferred when the asset has one — the scene never
 *  overshoots the budget at load time and residency promotes what the camera
 *  looks at; a missing coarse file falls back to the full one. */
export async function readAssetBytes(
  entry: AssetEntry,
  coarseFirst: boolean,
): Promise<{ bytes: ArrayBuffer; variant: AssetVariant }> {
  const dir = await modelStoreDir(entry.store);
  if (coarseFirst && entry.coarse) {
    try {
      return { bytes: await readFile(dir, `${entry.id}.coarse.tdp`), variant: 'coarse' };
    } catch {
      // missing coarse file — the full one below
    }
  }
  return { bytes: await readFile(dir, `${entry.id}.tdp`), variant: 'full' };
}
