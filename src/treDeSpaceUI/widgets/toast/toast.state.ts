import { createStore } from '../../lib/createStore';
import type { Tone } from '../tone';

/** One queued notification. Pure data — the dismiss timers live in
 *  toast.actions.ts. */
export interface ToastItem {
  /** What toast.dismiss / hold / resume take (returned by toast.info etc.). */
  id: string;
  /** Semantic colour; `toast.error` uses 'danger'. */
  tone: Tone;
  /** Bold first line; omit for a single-line toast. */
  title?: string;
  /** The text. */
  message: string;
  /** ms before it auto-dismisses; 0 keeps it until the user closes it. */
  duration: number;
}

export interface ToastState {
  /** The stack, oldest first. */
  items: readonly ToastItem[];
}

export const toastState = createStore<ToastState>({ items: [] });
