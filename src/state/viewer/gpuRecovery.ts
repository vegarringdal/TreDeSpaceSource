// GPU device-loss recovery. The model DB worker is CPU-side and survives a GPU
// crash with every hierarchy, item state, color and transform intact — only
// VRAM is gone. So recovery remounts the viewport (fresh adapter, device and
// Renderer in the same host), rebuilds the renderer's model array slot by slot
// to match the worker's (geometry re-read from the OPFS asset store, tombstones
// reserved for removed slots so item ids stay aligned), re-pushes item states
// and the transform pool, and re-seats the camera where it was.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import type { Renderer } from '../../lib/render/renderer';
import { readAssetBytes } from '../assets/assetBytes';
import { type AssetEntry, assetsState, groupOf } from '../assets/assets.state';
import { db, transfer } from './db';
import { residency } from './residency';
import { viewerActions } from './viewer.actions';
import { viewerState } from './viewer.state';
import { vramBudgetMb } from './vramBudget';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type CameraPose = Readonly<{
  target: readonly [number, number, number];
  azimuth: number;
  elevation: number;
  orbitDistance: number;
}>;

type RebuildResult = Readonly<{ restored: number; failed: string[] }>;

/** Boots a fresh renderer in the viewport's host; resolves with it, or null
 *  when WebGPU init failed. The viewport panel registers this on mount. */
type RemountViewport = () => Promise<Renderer | null>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const RECOVER_TITLE = 'Recovering';
const LOST_MESSAGE =
  'The graphics device was lost — the GPU crashed or ran out of memory (too many models ' +
  'loaded, or another application took the memory). Recover? The viewport restarts and the ' +
  'loaded models are read back from the asset store; selection, colors, hidden items and ' +
  'transforms are kept.';

// -----------------------------------------------------------------------------
// state (live callbacks — not a store)
// -----------------------------------------------------------------------------

let remountViewport: RemountViewport | null = null;
let isRecovering = false;

export function registerViewportRemount(fn: RemountViewport | null): void {
  remountViewport = fn;
}

// -----------------------------------------------------------------------------
// entry point
// -----------------------------------------------------------------------------

/** The renderer's device-lost hook lands here: snapshot the camera, ask the
 *  user, run the recovery. Declining leaves the dead viewport with its error
 *  HUD (the rest of the app keeps working against the worker). */
export async function onGpuDeviceLost(dead: Renderer, message: string): Promise<void> {
  if (isRecovering) {
    return;
  }
  const pose = capturePose(dead);
  consoleActions.log('error', `GPU device lost — ${message}`);
  const ok = await dialogs.confirm(LOST_MESSAGE, {
    title: 'Oh no, the GPU crashed',
    okLabel: 'Recover',
    cancelLabel: 'Leave it',
  });
  if (!ok) {
    return;
  }
  await recoverGpu(pose);
}

// -----------------------------------------------------------------------------
// recovery
// -----------------------------------------------------------------------------

async function recoverGpu(pose: CameraPose): Promise<void> {
  if (!remountViewport) {
    dialogs.error('The viewport is not mounted — reload the page.', 'GPU recovery failed');
    return;
  }
  isRecovering = true;
  dialogs.loading('Restarting the graphics device…', RECOVER_TITLE);
  residency.pause();
  try {
    const renderer = await remountViewport();
    if (!renderer) {
      dialogs.error('WebGPU could not be re-initialised. Reload the page once the GPU is back.', 'GPU recovery failed');
      return;
    }
    residency.reset();
    const result = await rebuildModels(renderer);
    renderer.camera.setPose(pose.target, pose.azimuth, pose.elevation, pose.orbitDistance);
    viewerActions.bumpModelsVersion();
    report(result);
  } finally {
    residency.resume();
    dialogs.hideLoading();
    isRecovering = false;
  }
}

/** Walk the worker's slots in order: a live slot gets its geometry re-read
 *  from the asset store and uploaded (sequential uploads reproduce the
 *  original slot indices and item bases), a removed one a tombstone. A live
 *  model whose file is gone or no longer matches is unloaded in the worker
 *  too, so the two arrays stay consistent. */
async function rebuildModels(renderer: Renderer): Promise<RebuildResult> {
  const slots = await db.slotSummaries();
  const assets = assetsState.get().assets;
  const coarseFirst = vramBudgetMb(viewerState.get()) > 0;
  const live: number[] = [];
  const lost: number[] = [];
  const failed: string[] = [];
  for (let slot = 0; slot < slots.length; slot++) {
    const s = slots[slot];
    if (s.removed) {
      renderer.reserveTombstone(s.itemCount);
      continue;
    }
    const label = s.group && s.group !== s.name ? `${s.group}/${s.name}` : s.name;
    dialogs.loading(`Reloading ${label}…`, RECOVER_TITLE, slot / slots.length);
    const entry = assets.find((a) => a.name === s.name && groupOf(a) === s.group && a.store === s.store);
    const restored = entry ? await restoreSlot(renderer, slot, entry, coarseFirst) : false;
    if (!restored) {
      renderer.reserveTombstone(s.itemCount);
      lost.push(slot);
      failed.push(label);
      continue;
    }
    live.push(slot);
  }
  for (const u of await db.statesFor(live)) {
    renderer.writeItemStates(u.model, u.states);
  }
  renderer.writeTransforms(await db.transformsNow());
  if (lost.length > 0) {
    await db.removeModels(lost);
    await db.resetItemStates(lost);
  }
  return { restored: live.length, failed };
}

/** Re-read one asset's cooked bytes (coarse first under a VRAM budget, like a
 *  fresh load), repack them in the worker for the SAME slot and upload. False
 *  when the file is missing or its item table no longer matches the model. */
async function restoreSlot(
  renderer: Renderer,
  slot: number,
  entry: AssetEntry,
  coarseFirst: boolean,
): Promise<boolean> {
  try {
    const { bytes, variant } = await readAssetBytes(entry, coarseFirst);
    const packed = await db.repackModel(slot, transfer(bytes, [bytes]));
    renderer.uploadModel(packed, { edges: entry.edges !== false });
    residency.register(entry, slot, renderer, variant, packed.packDropped);
    return true;
  } catch (e) {
    consoleActions.log('error', `GPU recovery: ${entry.name} — ${e}`);
    return false;
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function capturePose(renderer: Renderer): CameraPose {
  const c = renderer.camera;
  return {
    target: [c.target[0], c.target[1], c.target[2]],
    azimuth: c.azimuth,
    elevation: c.elevation,
    orbitDistance: c.orbitDistance,
  };
}

function report({ restored, failed }: RebuildResult): void {
  consoleActions.log('info', `GPU recovered — ${restored} model(s) reloaded`);
  if (failed.length > 0) {
    dialogs.error(
      `These models could not be restored (file missing or changed) and were unloaded: ${failed.join(', ')}`,
      'GPU recovered with losses',
    );
  }
}
