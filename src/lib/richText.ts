/** Minimal rich-text rendering shared by scene labels and viewpoint
 *  descriptions: HTML-escape, then **bold** spans + newlines. */

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
