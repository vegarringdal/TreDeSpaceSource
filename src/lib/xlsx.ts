// Minimal .xlsx writer — one sheet, a header row, plain values, no styles.
// Just enough OOXML for Excel / LibreOffice to open a query result, with no
// dependency; the container is the STORED zip in ./zip.ts. Pure, unit-tested.
import { type ZipEntry, zipStored } from './zip';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Excel's hard limit for one cell's text. */
const MAX_CELL_CHARS = 32767;
const MAX_SHEET_NAME = 31;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

const CONTENT_TYPES =
  `${XML_HEAD}<Types xmlns="${NS_CONTENT_TYPES}">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>';
const ROOT_RELS =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';
const WORKBOOK_RELS =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  '</Relationships>';
/** The header row stays visible while scrolling. */
const FROZEN_HEADER =
  '<sheetViews><sheetView workbookViewId="0">' +
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
  '</sheetView></sheetViews>';

/** XML text: escape the markup characters and drop what XML 1.0 forbids
 *  (control characters other than tab / newline) — Excel refuses the file
 *  otherwise. */
export function escapeXml(s: string): string {
  return s
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Column index → letters: 0 → A, 25 → Z, 26 → AA … */
export function columnRef(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** Excel forbids `\ / ? * [ ] :` in a sheet name and caps it at 31 characters. */
export function sheetNameFor(title: string): string {
  const clean = title
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SHEET_NAME)
    .trim();
  return clean || 'Sheet1';
}

/** One cell: finite numbers stay numbers, booleans stay booleans, null /
 *  undefined are left out (an empty cell), everything else is inline text. */
function cellXml(ref: string, v: unknown): string {
  if (v == null) {
    return '';
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<c r="${ref}"><v>${v}</v></c>`;
  }
  if (typeof v === 'boolean') {
    return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  }
  const text = escapeXml(String(v).slice(0, MAX_CELL_CHARS));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function rowXml(r: number, cells: readonly unknown[]): string {
  let s = `<row r="${r}">`;
  for (let c = 0; c < cells.length; c++) {
    s += cellXml(`${columnRef(c)}${r}`, cells[c]);
  }
  return `${s}</row>`;
}

function sheetXml(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const parts = [XML_HEAD, `<worksheet xmlns="${NS_MAIN}">`, FROZEN_HEADER, '<sheetData>', rowXml(1, columns)];
  for (let i = 0; i < rows.length; i++) {
    parts.push(rowXml(i + 2, rows[i]));
  }
  parts.push('</sheetData></worksheet>');
  return parts.join('');
}

/** The complete .xlsx bytes for a header + rows, the sheet named after
 *  `title` (sanitized). */
export function buildXlsx(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  title = 'Sheet1',
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const sheetName = escapeXml(sheetNameFor(title));
  const workbook =
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_DOC_REL}">` +
    `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(columns, rows)) },
  ];
  return zipStored(entries);
}
