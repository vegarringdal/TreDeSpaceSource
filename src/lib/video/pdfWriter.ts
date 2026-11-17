// -----------------------------------------------------------------------------
// minimal PDF writer (step stills — DESIGN.md › Animation, D49)
// -----------------------------------------------------------------------------
// One page per still: a title, the JPEG picture fitted below it and wrapped
// text under the picture, on an A4 landscape page. Only what that needs:
// DCTDecode images (the JPEG bytes as they are), the standard Helvetica font
// (no embedding) with WinAnsi text, and a correct xref table. Pure — no deps.

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface PdfPage {
  /** JPEG file bytes */
  jpeg: Uint8Array;
  /** picture size in px (its aspect is kept) */
  width: number;
  height: number;
  title: string;
  /** text under the picture (wrapped to the page) */
  text: string;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const TITLE_PT = 16;
const TEXT_PT = 10;
const LINE_GAP = 1.35;
/** Helvetica's mean glyph width, as a share of the font size (wrapping). */
const CHAR_W = 0.5;
const MAX_TEXT_LINES = 6;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** WinAnsi-safe PDF string: escapes ( ) \ and replaces what Latin-1 lacks. */
function pdfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63;
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
    } else if (c === 0x2014 || c === 0x2013) {
      out += '-';
    } else if (c === 0x2019 || c === 0x2018) {
      out += "'";
    } else if (c === 0x201c || c === 0x201d) {
      out += '"';
    } else if (c < 32 || c > 255) {
      out += c === 9 ? ' ' : '?';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Words wrapped to lines of at most `width` points at `size`. */
export function wrapText(text: string, width: number, size: number): string[] {
  const perLine = Math.max(10, Math.floor(width / (size * CHAR_W)));
  const lines: string[] = [];
  for (const para of text.replace(/\*\*/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > perLine) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines.filter((l, i) => l !== '' || i < lines.length - 1);
}

/** One byte per character: every string written is ASCII or (text) already
 *  reduced to Latin-1 by pdfText, which WinAnsi reads byte for byte. */
const ascii = (s: string) => Uint8Array.from(s, (ch) => (ch.codePointAt(0) ?? 63) & 0xff);

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The PDF file for `pages` (one still each). */
export function buildPdf(pages: readonly PdfPage[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const write = (b: Uint8Array) => {
    chunks.push(b);
    size += b.length;
  };
  // objects: 1 catalog, 2 pages, 3 font, then per page: page, content, image
  const pageObj = (i: number) => 4 + i * 3;
  const object = (n: number, body: Uint8Array[] | string) => {
    offsets[n] = size;
    write(ascii(`${n} 0 obj\n`));
    for (const b of typeof body === 'string' ? [ascii(body)] : body) {
      write(b);
    }
    write(ascii('\nendobj\n'));
  };

  write(ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  pages.forEach((p, i) => {
    const n = pageObj(i);
    const lines = wrapText(p.text, PAGE_W - 2 * MARGIN, TEXT_PT).slice(0, MAX_TEXT_LINES);
    const textH = lines.length * TEXT_PT * LINE_GAP;
    const top = PAGE_H - MARGIN - TITLE_PT * LINE_GAP;
    const boxW = PAGE_W - 2 * MARGIN;
    const boxH = top - MARGIN - textH - (lines.length ? TEXT_PT : 0);
    const scale = Math.min(boxW / Math.max(1, p.width), boxH / Math.max(1, p.height));
    const w = p.width * scale;
    const h = p.height * scale;
    const x = MARGIN + (boxW - w) / 2;
    const y = top - h - TEXT_PT / 2;
    const text = lines
      .map(
        (l, k) =>
          `BT /F1 ${TEXT_PT} Tf ${MARGIN} ${(y - TEXT_PT * LINE_GAP * (k + 1)).toFixed(1)} Td (${pdfText(l)}) Tj ET`,
      )
      .join('\n');
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q
BT /F1 ${TITLE_PT} Tf ${MARGIN} ${(PAGE_H - MARGIN - TITLE_PT).toFixed(1)} Td (${pdfText(p.title)}) Tj ET
${text}`;
    object(
      n,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`,
    );
    const contentBytes = ascii(content);
    object(n + 1, [ascii(`<< /Length ${contentBytes.length} >>\nstream\n`), contentBytes, ascii('\nendstream')]);
    object(n + 2, [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      ),
      p.jpeg,
      ascii('\nendstream'),
    ]);
  });
  const count = 4 + pages.length * 3;
  const xref = size;
  const entries = Array.from({ length: count }, (_, n) =>
    n === 0 ? '0000000000 65535 f \n' : `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`,
  );
  write(
    ascii(
      `xref\n0 ${count}\n${entries.join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
