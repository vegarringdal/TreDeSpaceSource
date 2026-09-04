/** Outcome of a clipboard write — `error` is the reason it did not happen. */
export type CopyResult = Readonly<{ error?: string }>;

/** Write text to the system clipboard. Never throws: the Clipboard API is
 *  missing outside secure contexts, and the browser refuses the write when the
 *  page is not focused or the user gesture has expired. */
export async function copyText(text: string): Promise<CopyResult> {
  if (!navigator.clipboard?.writeText) {
    return { error: 'The clipboard is not available in this context' };
  }
  try {
    await navigator.clipboard.writeText(text);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
