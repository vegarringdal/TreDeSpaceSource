// -----------------------------------------------------------------------------
// SVG overlay capture
// -----------------------------------------------------------------------------
// Rasterize one viewport SVG overlay at capture resolution for screenshots
// (and, later, video frames). Two rules, both measured in headless Chrome:
//
//   - The SVG goes in as a `data:` URL. The same SVG as a `blob:` URL TAINTS
//     the canvas as soon as it holds a <foreignObject> (the animation cards),
//     and a tainted canvas makes the whole screenshot's toBlob() throw.
//   - It is drawn onto its own scratch canvas and taint-checked there first,
//     so one overlay the browser refuses can never sink the capture — the
//     composite only ever receives clean canvases.
//
// viewBox keeps the CSS-px layout, width/height are the shot's pixels: the
// browser re-draws the vectors and the HTML at full resolution (no stretched
// viewport-sized bitmap).

/** The overlay drawn at `shotW × shotH`, or null when it cannot be captured. */
export async function rasterizeSvgOverlay(
  svg: SVGSVGElement,
  rect: { width: number; height: number },
  shotW: number,
  shotH: number,
): Promise<HTMLCanvasElement | null> {
  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGSVGElement)) {
    return null;
  }
  clone.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  clone.setAttribute('width', String(shotW));
  clone.setAttribute('height', String(shotH));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('overlay rasterise failed'));
      img.src = url;
    });
  } catch {
    return null;
  }
  const scratch = document.createElement('canvas');
  scratch.width = shotW;
  scratch.height = shotH;
  const ctx = scratch.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.drawImage(img, 0, 0, shotW, shotH);
  try {
    ctx.getImageData(0, 0, 1, 1); // throws SecurityError on a tainted canvas
  } catch {
    return null;
  }
  return scratch;
}
