import { describe, expect, it } from 'vitest';
import { buildPdf, wrapText } from '../src/lib/video/pdfWriter';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('pdf writer', () => {
  it('writes pages whose xref offsets point at their objects', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildPdf([
      { jpeg, width: 40, height: 30, title: 'Step 1 — Base (frame)', text: 'Put the **frame** down.\nThen bolt it. Café' },
      { jpeg, width: 30, height: 40, title: 'Step 2', text: '' },
    ]);
    const s = latin1(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(s.match(/startxref\n(\d+)/)?.[1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const rows = [...s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(rows).toHaveLength(9); // catalog, pages, font + 3 per page
    rows.forEach((at, i) => expect(s.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(s).toContain('(Step 1 - Base \\(frame\\)) Tj');
    expect(s).toContain('Caf\xe9');
    expect(s).not.toContain('**');
    expect(s).toContain('/Count 2');
  });

  it('wraps long text at word boundaries', () => {
    const lines = wrapText('aa '.repeat(100), 100, 10);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
  });
});
