// Device-class detection for the smart render-scale default.
//
// Phones/tablets have integer devicePixelRatios (2–3), so compositor upscaling
// of a ratio-1 render stays uniform and rendering native would cost 4–9× the
// fragment work. Desktops — notably Windows at 125/150% scale — have
// FRACTIONAL ratios that shred the post pass's 1px edge lines unless the
// canvas renders at the native device pixel grid.

/** True on Android/iOS phones and tablets. iPadOS 13+ masquerades as desktop
 *  macOS in the UA — touch points are the only remaining distinguisher. */
export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod/i.test(ua)) {
    return true;
  }
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}
