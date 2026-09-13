import type { Tone } from '../tone';
import { type ToastItem, toastState } from './toast.state';

export interface ToastOptions {
  /** Bold first line above the message. */
  title?: string;
  /** ms before it auto-dismisses (default 4000); 0 keeps it until closed. */
  duration?: number;
}

/** Newest-first cap: a burst of failures must not bury the screen. */
const MAX_VISIBLE = 4;
const DEFAULT_DURATION_MS = 4000;

let seq = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
  const t = timers.get(id);
  if (t != null) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function dismiss(id: string): void {
  clearTimer(id);
  toastState.set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}

function arm(id: string, duration: number): void {
  clearTimer(id);
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    );
  }
}

function push(tone: Tone, message: string, opts: ToastOptions = {}): string {
  const id = `t${++seq}`;
  const item: ToastItem = { id, tone, title: opts.title, message, duration: opts.duration ?? DEFAULT_DURATION_MS };
  toastState.set((s) => {
    const dropped = [...s.items, item].slice(-MAX_VISIBLE);
    for (const t of s.items) {
      if (!dropped.includes(t)) {
        clearTimer(t.id);
      }
    }
    return { items: dropped };
  });
  arm(id, item.duration);
  return id;
}

/**
 * Non-blocking notifications — the alternative to stopping the user with a
 * confirm() they can only acknowledge. Callable from anywhere, React or not;
 * render {@link Toaster} once at the app root to show them.
 */
export const toast = {
  info: (message: string, opts?: ToastOptions) => push('info', message, opts),
  success: (message: string, opts?: ToastOptions) => push('success', message, opts),
  warning: (message: string, opts?: ToastOptions) => push('warning', message, opts),
  /** Errors stay until dismissed — the user must be able to read them. */
  error: (message: string, opts?: ToastOptions) => push('danger', message, { duration: 0, ...opts }),
  dismiss,
  /** Pause the countdown (pointer over the stack) and resume it on leave. */
  hold: (id: string) => clearTimer(id),
  resume: (id: string, duration: number) => arm(id, duration),
  clear: () => {
    for (const id of [...timers.keys()]) {
      clearTimer(id);
    }
    toastState.set({ items: [] });
  },
};
