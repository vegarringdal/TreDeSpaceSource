/** Minimal rich-text rendering shared by scene labels and viewpoint
 *  descriptions: HTML-escape, then **bold** spans + newlines. */

/** Escape text for HTML/SVG markup. Quotes are escaped too, so the result is
 *  safe inside a quoted attribute as well as in element content. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The first non-blank line of a multi-line text, trimmed — what a list row
 *  shows for a label that spells out more in the viewport. '' when blank. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  );
}

/** Escaped HTML with **bold** → <b> and newlines → <br>. */
export function richTextHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}
