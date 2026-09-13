import { flushSync } from 'react-dom';
import { dialogsState } from './dialogs.state';

export interface ConfirmOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Called with true for OK, false for Cancel/Escape. */
  onResult?: (ok: boolean) => void;
}

// The live resolvers are not state — a restored-from-JSON dialog simply closes.
let pendingConfirm: ((ok: boolean) => void) | null = null;
let pendingPrompt: ((value: string | null) => void) | null = null;

/** While > 0, hideLoading() is a no-op — a multi-phase flow (batch import)
 *  holds the overlay so per-phase hide/show pairs don't blink it. */
let loadingHold = 0;

const clearLoading = () => dialogsState.set({ loading: null });

/** Global dialog triggers — callable from anywhere, React or not. */
export const dialogs = {
  error(message: string, title = 'Something went wrong') {
    dialogsState.set({ error: { title, message } });
  },
  dismissError() {
    dialogsState.set({ error: null });
  },

  /** Show the blocking loading overlay. Returns a disposer, or use hideLoading().
   *  `progress` (0..1) renders a determinate bar under the label.
   *  On the hidden → shown transition flushSync forces React to COMMIT the
   *  overlay to the DOM before the caller's next synchronous work (e.g.
   *  `new Worker(...)`, wasm load) can block the main thread — otherwise the
   *  commit batches behind it and the overlay appears seconds late, leaving
   *  the UI clickable. Once the overlay is up, progress ticks are plain
   *  batched updates (converter proxies and chunk uploads call this per tick;
   *  a synchronous commit each time stalled the main thread), and a tick that
   *  changes nothing is dropped before it reaches the store. */
  loading(label = 'Loading…', title = 'Please wait', progress?: number) {
    const next = { title, label, progress: progress ?? null };
    const cur = dialogsState.get().loading;
    if (cur && cur.title === next.title && cur.label === next.label && cur.progress === next.progress) {
      return clearLoading;
    }
    if (cur) {
      dialogsState.set({ loading: next });
    } else {
      flushSync(() => dialogsState.set({ loading: next }));
    }
    return clearLoading;
  },
  hideLoading() {
    if (loadingHold > 0) {
      return;
    }
    clearLoading();
  },

  /** Keep the loading overlay up across a multi-phase flow: intermediate
   *  hideLoading() calls become no-ops until releaseLoading(). Callers pair
   *  release with a final hideLoading() of their own. */
  holdLoading() {
    loadingHold++;
  },
  releaseLoading() {
    loadingHold = Math.max(0, loadingHold - 1);
  },

  /** OK/Cancel question. Fires onResult and also resolves the returned promise. */
  confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      pendingConfirm = (ok: boolean) => {
        opts.onResult?.(ok);
        resolve(ok);
      };
      dialogsState.set({
        confirm: {
          message,
          title: opts.title ?? 'Are you sure?',
          okLabel: opts.okLabel ?? 'OK',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
        },
      });
    });
  },
  /** The confirm buttons land here. */
  resolveConfirm(ok: boolean) {
    dialogsState.set({ confirm: null });
    pendingConfirm?.(ok);
    pendingConfirm = null;
  },

  /** One-line text input. Resolves the entered string, or null on cancel. */
  prompt(
    message: string,
    opts: { title?: string; defaultValue?: string; okLabel?: string } = {},
  ): Promise<string | null> {
    return new Promise((resolve) => {
      pendingPrompt = resolve;
      dialogsState.set({
        prompt: {
          message,
          title: opts.title ?? 'Enter a value',
          value: opts.defaultValue ?? '',
          okLabel: opts.okLabel ?? 'OK',
        },
      });
    });
  },
  setPromptValue(value: string) {
    dialogsState.set((s) => (s.prompt ? { prompt: { ...s.prompt, value } } : s));
  },
  resolvePrompt(ok: boolean) {
    const value = dialogsState.get().prompt?.value ?? '';
    dialogsState.set({ prompt: null });
    pendingPrompt?.(ok ? value : null);
    pendingPrompt = null;
  },
};
