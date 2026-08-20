// Tiny registries that let global hotkeys / ribbon actions reach panel-local
// abilities (same pattern as registerRenderer): the owner registers a callback
// on mount and clears it on unmount; callers just invoke.

/** A single nullable callback slot. */
export function makeCallbackSlot(): {
  register: (fn: (() => void) | null) => void;
  call: () => void;
  isSet: () => boolean;
} {
  let fn: (() => void) | null = null;
  return {
    register: (f) => {
      fn = f;
    },
    call: () => fn?.(),
    isSet: () => fn != null,
  };
}
