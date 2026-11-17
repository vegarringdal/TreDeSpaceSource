// Opt-in performance tracing (Settings → Stats → "Verbose trace"). When off,
// startTrace() returns null and every `trace?.mark(...)` is a no-op — zero cost.
// When on, a Trace accumulates phase durations (performance.now deltas, so the
// numbers add up to the wall-clock total) and flushes them to the Console panel
// as one chronological block. Cross-thread work (the modeldb worker) measures
// its own phases and hands them back via merge().
import { consoleActions } from '../components/panels/console/console.actions';
import { viewerState } from '../state/viewer/viewer.state';

export interface TracePhase {
  label: string;
  ms: number;
}

export class Trace {
  private readonly t0 = performance.now();
  private last = this.t0;
  private readonly phases: TracePhase[] = [];
  private readonly title: string;
  constructor(title: string) {
    this.title = title;
  }

  /** Close the current segment under `label` — the time since the previous
   *  mark() / merge() / construction. */
  mark(label: string): void {
    const now = performance.now();
    this.phases.push({ label, ms: now - this.last });
    this.last = now;
  }

  /** Record a phase measured out-of-band (e.g. a subtraction). Does NOT touch
   *  the segment clock, so a following mark() still measures from the last one. */
  add(label: string, ms: number): void {
    this.phases.push({ label, ms });
  }

  /** Fold in phases already measured elsewhere (e.g. returned by the worker),
   *  then reset the segment clock so the next mark() doesn't double-count. */
  merge(sub: TracePhase[] | undefined, prefix = ''): void {
    if (sub) {
      for (const p of sub) {
        this.phases.push({ label: prefix + p.label, ms: p.ms });
      }
    }
    this.last = performance.now();
  }

  /** Log the whole run to the Console and stop. */
  flush(): void {
    const total = performance.now() - this.t0;
    consoleActions.log('info', `[trace] ${this.title} — ${total.toFixed(1)} ms total`);
    for (const p of this.phases) {
      consoleActions.log('info', `[trace]   ${p.ms.toFixed(1).padStart(9)} ms  ${p.label}`);
    }
  }
}

/** True when verbose tracing is enabled (also the flag to pass into workers). */
export const traceEnabled = (): boolean => viewerState.get().trace;

/** Begin a trace only when enabled; null when off — guard calls with `trace?.`. */
export const startTrace = (title: string): Trace | null => (traceEnabled() ? new Trace(title) : null);
