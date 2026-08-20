// State for the modal external dialogs (Settings → External → "Modal
// dialog"): which app iframes are open, plus their initial size parsed from
// the app's config JSON: {"width": "600px", "height": "60%"} — px or % (of
// the viewport), a number means px; default 70% × 70%.
import { createStore } from '@treDeSpaceUI/lib/createStore';
import { type ExternalApp, externalAppUrl } from '../../../state/externalApps.state';

export interface OpenModal {
  key: string;
  appId: string;
  name: string;
  url: string;
  width: string;
  height: string;
}

export const externalModalsState = createStore<{ open: OpenModal[] }>({ open: [] });
let seq = 0;

/** "600px" / "60%" / 600 → CSS length; anything else → null. */
function dim(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return `${v}px`;
  }
  if (typeof v === 'string' && /^\d+(\.\d+)?(px|%)$/.test(v.trim())) {
    return v.trim();
  }
  return null;
}

function initialSize(config: string): { width: string; height: string } {
  const fallback = { width: '70%', height: '70%' };
  try {
    const c = JSON.parse(config) as Record<string, unknown>;
    return { width: dim(c.width) ?? fallback.width, height: dim(c.height) ?? fallback.height };
  } catch {
    return fallback;
  }
}

/** Open an external app as a modal dialog (single-instance apps re-focus the
 *  existing dialog instead of opening a second one). */
export function openExternalModal(app: ExternalApp) {
  externalModalsState.set((s) => {
    // single-instance apps: re-opening brings the existing dialog to the top
    const existing = !app.multiple ? s.open.find((m) => m.appId === app.id) : undefined;
    if (existing) {
      return { open: [...s.open.filter((m) => m.key !== existing.key), existing] };
    }
    const size = initialSize(app.config);
    return {
      open: [
        ...s.open,
        { key: `${app.id}:${seq++}`, appId: app.id, name: app.name, url: externalAppUrl(app), ...size },
      ],
    };
  });
}

/** Close one external modal dialog by its instance key. */
export function closeExternalModal(key: string) {
  externalModalsState.set((s) => ({ open: s.open.filter((m) => m.key !== key) }));
}
