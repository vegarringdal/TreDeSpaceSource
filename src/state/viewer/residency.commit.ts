// The swap path of the residency manager, split in two: an async PREPARE
// (every fallible, slow step — the OPFS read, the worker repack, and the
// item-state fetch) and a synchronous COMMIT (`apply`: tombstone the slot,
// rebuild it, re-push states, update the record). residency.ts queues
// prepared commits and applies a whole batch in one tick, so N swaps cost
// one accumulation reset instead of N, and the slot never renders with a
// zero-initialised state buffer — the states are in hand before it dies.
import { transfer } from 'comlink';
import { modelStoreDir, readFile } from '../../lib/opfs/opfs';
import type { Renderer } from '../../lib/render/renderer';
import { db } from './db';
import type { Cuts } from './residency.plan';
import { isCoarseBroken, noteCoarseFailure, type ResidencyRecord } from './residency.record';

/** Commit order inside a flush: frees before allocations, so a batch never
 * overshoots the budget between its own steps. */
export const COMMIT_ORDER = { unload: 0, demote: 1, refresh: 2, promote: 3 } as const;

export interface ReadyCommit {
  slot: number;
  label: string;
  /** `performance.now()` when the prepare finished — bounds how long a
   * commit may wait for batch-mates. */
  readyT: number;
  /** No pixel can change: skip the re-render and the accumulation reset. */
  quiet: boolean;
  order: (typeof COMMIT_ORDER)[keyof typeof COMMIT_ORDER];
  /** The level the zone had when the swap was planned (event log). */
  from: ResidencyRecord['variant'];
  /** Cooldown the record gets after this commit lands (0 = none). */
  cooldownMs: number;
  /** Rebuild the slot and update the record. Synchronous; must only be
   * called while the record is still tracked. */
  apply(r: Renderer): void;
}

type StateUpdates = Awaited<ReturnType<typeof db.statesFor>>;

/** Tombstone → revive → states, the atomic core every commit shares. */
function rebuildSlot(
  r: Renderer,
  rec: ResidencyRecord,
  packed: Parameters<Renderer['reviveModel']>[1],
  states: StateUpdates,
  quiet: boolean,
): void {
  r.removeModels([rec.slot], { quiet });
  r.reviveModel(rec.slot, packed, { edges: rec.edges, quiet });
  for (const u of states) {
    r.writeItemStates(u.model, u.states, quiet);
  }
}

function resetPackInfo(rec: ResidencyRecord): void {
  rec.packedEye = null;
  rec.packedDir = null;
  rec.packedTarget = 0;
}

/** Promote (or restore) to the FULL variant. */
export async function prepareFull(rec: ResidencyRecord, cooldownMs: number): Promise<ReadyCommit> {
  const bytes = await readFile(await modelStoreDir(rec.store), `${rec.assetId}.tdp`);
  const packed = await db.repackModel(rec.slot, transfer(bytes, [bytes]));
  const states = await db.statesFor([rec.slot]);
  return {
    slot: rec.slot,
    label: rec.label,
    readyT: performance.now(),
    quiet: false,
    order: COMMIT_ORDER.promote,
    from: rec.variant,
    cooldownMs,
    apply(r) {
      rebuildSlot(r, rec, packed, states, false);
      rec.variant = 'full';
      rec.lastPromoteT = performance.now();
      resetPackInfo(rec);
      rec.packDropped = packed.packDropped;
      rec.bytesFull = r.modelBytes(rec.slot);
    },
  };
}

/** Mixed promote (tier 2.5): the items nearest the camera come from the full
 * file — greedily up to `targetBytes` — and the remainder from the coarse
 * file, packed into one slot. The sharp region is re-centered by re-packing
 * when the camera moves far enough from `packedEye`. */
export async function prepareMixed(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  fwd: readonly [number, number, number],
  targetBytes: number,
  cuts: Cuts,
  cooldownMs: number,
): Promise<ReadyCommit> {
  const dir = await modelStoreDir(rec.store);
  const fullBytes = await readFile(dir, `${rec.assetId}.tdp`);
  const coarseBytes = await readFile(dir, `${rec.assetId}.coarse.tdp`);
  const packed = await db.repackModelMixed(
    rec.slot,
    transfer(fullBytes, [fullBytes]),
    transfer(coarseBytes, [coarseBytes]),
    eye,
    targetBytes,
    cuts,
    r.viewProjMatrix,
    r.clipData,
  );
  const states = await db.statesFor([rec.slot]);
  return {
    slot: rec.slot,
    label: rec.label,
    readyT: performance.now(),
    quiet: false,
    order: COMMIT_ORDER.promote,
    from: rec.variant,
    cooldownMs,
    apply(rr) {
      rebuildSlot(rr, rec, packed, states, false);
      rec.variant = 'mixed';
      rec.lastPromoteT = performance.now();
      rec.packedEye = [eye[0], eye[1], eye[2]];
      rec.packedDir = [fwd[0], fwd[1], fwd[2]];
      rec.packedTarget = targetBytes;
      rec.packLimited = packed.fullBudgetLimited;
      rec.packDropped = packed.packDropped;
    },
  };
}

/** Build (or rebuild) this zone's COARSE pack with the current cut set.
 * `mode` says what the swap means for the record: a demote from a resident
 * level, a repair from unloaded, or an in-place refresh of a stale pack
 * (which changes no level and therefore no dwell clock). A coarse failure is
 * recorded on the record (back-off / give-up) before the error propagates. */
export async function prepareCoarse(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  cuts: Cuts,
  mode: 'demote' | 'repair' | 'refresh',
  quiet: boolean,
  cooldownMs: number,
): Promise<ReadyCommit> {
  let packed: Awaited<ReturnType<typeof db.repackModelCoarse>>;
  let states: StateUpdates;
  try {
    const bytes = await readFile(await modelStoreDir(rec.store), `${rec.assetId}.coarse.tdp`);
    packed = await db.repackModelCoarse(rec.slot, transfer(bytes, [bytes]), eye, cuts, r.clipData);
    states = await db.statesFor([rec.slot]);
  } catch (e) {
    noteCoarseFailure(rec, e, performance.now());
    throw e;
  }
  return {
    slot: rec.slot,
    label: rec.label,
    readyT: performance.now(),
    quiet,
    order: mode === 'demote' ? COMMIT_ORDER.demote : mode === 'refresh' ? COMMIT_ORDER.refresh : COMMIT_ORDER.promote,
    from: rec.variant,
    cooldownMs,
    apply(rr) {
      rebuildSlot(rr, rec, packed, states, quiet);
      rec.variant = 'coarse';
      if (mode === 'demote') {
        rec.lastDemoteT = performance.now();
      } else if (mode === 'repair') {
        rec.lastPromoteT = performance.now();
      }
      resetPackInfo(rec);
      rec.coarseStale = false;
      rec.coarseFails = 0;
      rec.packDropped = packed.packDropped;
      // measured is better than the file-ratio estimate; cut-dependent, so
      // only ever grow the estimate (a heavily cut pack must not shrink the
      // budget the next repair plans with)
      rec.bytesCoarse = Math.max(rec.bytesCoarse, rr.modelBytes(rec.slot));
    },
  };
}

/** Free the slot entirely; the DbModel (tree, states, colors) stays. */
export function prepareUnload(rec: ResidencyRecord, quiet: boolean, cooldownMs: number): ReadyCommit {
  return {
    slot: rec.slot,
    label: rec.label,
    readyT: performance.now(),
    quiet,
    order: COMMIT_ORDER.unload,
    from: rec.variant,
    cooldownMs,
    apply(r) {
      r.removeModels([rec.slot], { quiet });
      rec.variant = 'unloaded';
      rec.lastDemoteT = performance.now();
      rec.coarseStale = false;
      resetPackInfo(rec);
      rec.packDropped = 0; // unloaded zones use the 0-meshlet CPU path anyway
    },
  };
}

/** Demote to the level the planner asked for. A coarse demote whose coarse
 * file fails falls back to an unload (the failure is recorded, so the next
 * plan sees the tier as broken for a while). */
export async function prepareDemote(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  cuts: Cuts,
  to: 'coarse' | 'unloaded',
  quiet: boolean,
  cooldownMs: number,
): Promise<ReadyCommit> {
  if (to === 'unloaded' || rec.visibleFrac === 0 || !rec.hasCoarse || isCoarseBroken(rec, performance.now())) {
    return prepareUnload(rec, quiet, cooldownMs);
  }
  try {
    return await prepareCoarse(r, rec, eye, cuts, 'demote', quiet, cooldownMs);
  } catch (e) {
    console.warn(`residency: coarse swap failed for ${rec.assetId}, falling back to unload:`, e);
    return prepareUnload(rec, quiet, cooldownMs);
  }
}
