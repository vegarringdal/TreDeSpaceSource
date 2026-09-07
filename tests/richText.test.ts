import { describe, expect, it } from 'vitest';
import { firstLine, richTextHtml } from '../src/lib/richText';

describe('firstLine', () => {
  it('returns the first non-blank line, trimmed', () => {
    expect(firstLine('**Point 3** sdsd\nsecond\nthird')).toBe('**Point 3** sdsd');
    expect(firstLine('\n  \n  Second is first  \nmore')).toBe('Second is first');
  });

  it('is empty for blank text', () => {
    expect(firstLine('')).toBe('');
    expect(firstLine(' \n ')).toBe('');
  });
});

describe('richTextHtml', () => {
  it('renders bold spans and escapes markup', () => {
    expect(richTextHtml('**Point 3** <b>x</b>')).toBe('<b>Point 3</b> &lt;b&gt;x&lt;/b&gt;');
  });
});
