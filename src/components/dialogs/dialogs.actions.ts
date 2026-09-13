import { toast } from '@treDeSpaceUI/widgets';
import { flushSync } from 'react-dom';
import { type DialogsState, dialogsState } from './dialogs.state';

export interface ConfirmOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Called with true for OK, false for Cancel/Escape. */
  onResult?: (ok: boolean) => void;
}

/**
 * The state holds ONE confirm and ONE prompt, so concurrent asks queue behind
 * the one on screen instead of replacing it — a second `confirm()` used to
 * overwrite the first's resolver and leave that caller awaiting forever. The
 * live resolvers are not state: a restored-from-JSON dialog simply closes.
 */
type Pending<D, R> = { dialog: D; resolve: (result: R) => void };

const confirmQueue: Pending<NonNullable<DialogsState['confirm']>, boolean>[] = [];
const promptQueue: Pending<NonNullable<DialogsState['prompt']>, string | null>[] = [];
let promptSeq = 0;

/** Show the head of a queue, or nothing when it has run dry. Called after a
 *  shift and BEFORE the answer is delivered, so a resolver that opens another
 *  dialog of the same kind finds an accurate queue. */
function showNextConfirm() {
  dialogsState.set({ confirm: confirmQueue[0]?.dialog ?? null });
}
function showNextPrompt() {
  dialogsState.set({ prompt: promptQueue[0]?.dialog ?? null });
}

/** While > 0, hideLoading() is a no-op — a multi-phase flow (batch import)
 *  holds the overlay so per-phase hide/show pairs don't blink it. */
let loadingHold = 0;

const clearLoading = () => dialogsState.set({ loading: null });

/** Global dialog triggers — callable from anywhere, React or not. */
export const dialogs = {
  error(message: string, title = 'Something went wrong') {
    dialogsState.set({ error: { title, message } });
  },

  /** A result the user should see but need not acknowledge — "Loaded 12
   *  labels". A toast, never a modal: an OK-only dialog interrupts for
   *  nothing. Use `error` for a failure that must be read and dismissed. */
  info(message: string, title?: string) {
    toast.info(message, { title });
  },
  /** A completed action worth confirming — same rules as {@link info}. */
  success(message: string, title?: string) {
    toast.success(message, { title });
  },
  /** Something went wrong but the app carried on. Stays until dismissed. */
  warn(message: string, title?: string) {
    toast.warning(message, { title, duration: 0 });
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

  /** OK/Cancel question. Fires onResult and also resolves the returned promise.
   *  A second question asked while one is up waits its turn. */
  confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      confirmQueue.push({
        dialog: {
          message,
          title: opts.title ?? 'Are you sure?',
          okLabel: opts.okLabel ?? 'OK',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
        },
        resolve: (ok) => {
          opts.onResult?.(ok);
          resolve(ok);
        },
      });
      if (confirmQueue.length === 1) {
        showNextConfirm();
      }
    });
  },
  /** The confirm buttons land here. */
  resolveConfirm(ok: boolean) {
    const answered = confirmQueue.shift();
    showNextConfirm();
    answered?.resolve(ok);
  },

  /** One-line text input. Resolves the entered string, or null on cancel.
   *  Queues behind another prompt the same way {@link confirm} does. */
  prompt(
    message: string,
    opts: { title?: string; defaultValue?: string; okLabel?: string } = {},
  ): Promise<string | null> {
    return new Promise((resolve) => {
      promptQueue.push({
        dialog: {
          message,
          title: opts.title ?? 'Enter a value',
          value: opts.defaultValue ?? '',
          okLabel: opts.okLabel ?? 'OK',
          seq: ++promptSeq,
        },
        resolve,
      });
      if (promptQueue.length === 1) {
        showNextPrompt();
      }
    });
  },
  setPromptValue(value: string) {
    // keep the queued entry in step with the state, so the typed text is what
    // resolvePrompt returns even if the dialog is re-shown from the queue
    if (promptQueue[0]) {
      promptQueue[0] = { ...promptQueue[0], dialog: { ...promptQueue[0].dialog, value } };
    }
    dialogsState.set((s) => (s.prompt ? { prompt: { ...s.prompt, value } } : s));
  },
  resolvePrompt(ok: boolean) {
    const value = dialogsState.get().prompt?.value ?? '';
    const answered = promptQueue.shift();
    showNextPrompt();
    answered?.resolve(ok ? value : null);
  },
};
