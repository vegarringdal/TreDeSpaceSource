import { createStore } from '@treDeSpaceUI/lib/createStore';

/**
 * Pure descriptors — everything here is JSON-serializable. The confirm
 * resolver (a function) deliberately lives in dialogs.actions.ts instead.
 */
export interface DialogsState {
  error: { title: string; message: string } | null;
  loading: { title: string; label: string; progress: number | null } | null;
  confirm: { title: string; message: string; okLabel: string; cancelLabel: string } | null;
  prompt: { title: string; message: string; value: string; okLabel: string } | null;
}

export const dialogsState = createStore<DialogsState>({ error: null, loading: null, confirm: null, prompt: null });
