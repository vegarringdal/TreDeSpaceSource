// A hotkey that opens a button's menu (Overlay ▾, Export ▾, Scene ▾…): the
// hotkey asks for the menu by id, and the button showing it — if one is on
// screen — opens it under itself, as a click does.

type Opener = () => void;

const openers = new Map<string, Set<Opener>>();

/** Open menu `id` where its button is (false: no such button on screen). */
export function requestMenu(id: string): boolean {
  const set = openers.get(id);
  const first = set?.values().next().value;
  if (!first) {
    return false;
  }
  first();
  return true;
}

/** Is a button with menu `id` on screen (the hotkey's context)? */
export function hasMenu(id: string): boolean {
  return (openers.get(id)?.size ?? 0) > 0;
}

/** A button's menu answers requests for `id` until the returned call. */
export function onMenuRequest(id: string, open: Opener): () => void {
  let set = openers.get(id);
  if (!set) {
    set = new Set();
    openers.set(id, set);
  }
  set.add(open);
  return () => {
    set.delete(open);
  };
}
