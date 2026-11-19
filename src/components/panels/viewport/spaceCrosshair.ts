// SpaceMouse centre crosshair: both SpaceMouse buttons act on what sits at the
// viewport centre (select / fly to), so while the device is in use a small
// crosshair marks that spot. It shows on any SpaceMouse move or button press
// and fades out once the device has been still for the configured time.
import { navState } from '../../../state/viewer/nav.state';
import { spaceMouseActions } from '../../../state/viewer/spaceMouse.actions';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SIZE_PX = 22;
const FADE_MS = 400;
const FADE_IN_MS = 100;

const CROSSHAIR_CSS =
  `position:absolute;left:50%;top:50%;width:${SIZE_PX}px;height:${SIZE_PX}px;` +
  'transform:translate(-50%,-50%);pointer-events:none;z-index:6;opacity:0;' +
  `transition:opacity ${FADE_MS}ms ease-out;filter:drop-shadow(0 0 1.5px rgba(0,0,0,0.9));`;

/** Four ticks around an open centre, so the crosshair never hides the aimed-at pixel. */
const CROSSHAIR_SVG =
  `<svg width="${SIZE_PX}" height="${SIZE_PX}" viewBox="0 0 22 22" fill="none" stroke="#f1f5f9" ` +
  'stroke-width="1.5" stroke-linecap="round"><path d="M11 2v6M11 14v6M2 11h6M14 11h6"/>' +
  '<circle cx="11" cy="11" r="0.9" fill="#f1f5f9" stroke="none"/></svg>';

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export type SpaceCrosshair = Readonly<{
  /** Per frame: show while the SpaceMouse was used within the hold time. */
  update: (now: number) => void;
  dispose: () => void;
}>;

/** Mounts the centre crosshair into the viewport host (hidden until the SpaceMouse moves). */
export function attachSpaceCrosshair(host: HTMLElement): SpaceCrosshair {
  const el = document.createElement('div');
  el.style.cssText = CROSSHAIR_CSS;
  el.innerHTML = CROSSHAIR_SVG;
  host.appendChild(el);
  let isShown = false;

  const update = (now: number) => {
    const nav = navState.get();
    const lastActive = spaceMouseActions.lastActiveTime();
    const shouldShow = nav.spaceCrosshair && lastActive > 0 && now - lastActive < nav.spaceCrosshairHoldSec * 1000;
    if (shouldShow !== isShown) {
      isShown = shouldShow;
      el.style.transitionDuration = `${shouldShow ? FADE_IN_MS : FADE_MS}ms`;
      el.style.opacity = shouldShow ? '1' : '0';
    }
  };

  return { update, dispose: () => el.remove() };
}
