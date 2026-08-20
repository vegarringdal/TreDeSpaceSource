/** Minimal rich-text rendering shared by scene labels and viewpoint
 *  descriptions: HTML-escape, then **bold** spans + newlines. */

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escaped HTML with **bold** → <b> and newlines → <br>. */
export function richTextHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}
