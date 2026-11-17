// The VRAM budget's on/off switch: `vramBudgetOn` enables it, `maxVramMb` is
// the ceiling. Pure (no store import) so the migration is unit-tested.
import type { ViewerState } from './viewer.state';

export const DEFAULT_VRAM_BUDGET_MB = 2048;

type BudgetFields = Pick<ViewerState, 'vramBudgetOn' | 'maxVramMb'>;

/** The budget in force: the ceiling while enabled, else 0 — the value every
 *  residency reader keys on ("0 = off"). */
export function vramBudgetMb(s: BudgetFields): number {
  return s.vramBudgetOn ? s.maxVramMb : 0;
}

/** Settings saved before the Enabled checkbox existed used `maxVramMb` alone
 *  as the switch (0 = off). A saved budget comes back enabled; a saved 0
 *  comes back off with the default ceiling, so the number field never
 *  shows 0. The same one-time pass moves the swap speed off the old default
 *  (Normal) to the new one (Fast) — a blob that predates the switch and is
 *  still on Normal never had it chosen. Blobs that already carry the switch
 *  pass through. */
export function migrateVramBudget(saved: Record<string, unknown>): Record<string, unknown> {
  if ('vramBudgetOn' in saved || typeof saved.maxVramMb !== 'number') {
    return saved;
  }
  const on = saved.maxVramMb > 0;
  return {
    ...saved,
    vramBudgetOn: on,
    maxVramMb: on ? saved.maxVramMb : DEFAULT_VRAM_BUDGET_MB,
    ...(saved.vramSwapSpeed === 'normal' ? { vramSwapSpeed: 'fast' } : {}),
  };
}
