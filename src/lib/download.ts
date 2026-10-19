/** How long a download's object URL lives — the browser has the bytes long before. */
const DOWNLOAD_URL_MS = 60_000;

/** Trigger a browser download of a Blob or File — a file from OPFS streams
 *  from disk, nothing is copied into memory. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_MS);
}

/** Trigger a browser download of a text file (JSON exports etc). */
export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of a binary file (GLB export etc). */
export function downloadBinary(filename: string, data: ArrayBuffer, mime = 'model/gltf-binary') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
