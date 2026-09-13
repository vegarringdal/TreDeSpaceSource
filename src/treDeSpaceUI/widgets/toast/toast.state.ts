import { createStore } from '../../lib/createStore';
import type { Tone } from '../tone';

/** One queued notification. Pure data — the dismiss timers live in
 *  toast.actions.ts. */
export interface ToastItem {
  id: string;
  tone: Tone;
  /** Bold first line; omit for a single-line toast. */
  title?: string;
  message: string;
  /** ms before it auto-dismisses; 0 keeps it until the user closes it. */
  duration: number;
}

export interface ToastState {
  items: readonly ToastItem[];
}

export const toastState = createStore<ToastState>({ items: [] });
