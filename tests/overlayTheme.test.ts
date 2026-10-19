import { describe, expect, it } from 'vitest';
import { autoTheme, DEFAULT_THEME, LIGHT_THEME } from '../src/lib/overlay/overlayPresets';

describe('autoTheme', () => {
  it("is Light in the app's light theme and Dark in the dark one — the library's copy when it has one", () => {
    expect(autoTheme('light').id).toBe(LIGHT_THEME.id);
    expect(autoTheme('dark').id).toBe(DEFAULT_THEME.id);
    expect(DEFAULT_THEME.name).toBe('Dark');
    const restyled = { ...LIGHT_THEME, tokens: { ...LIGHT_THEME.tokens, accent: '#ff0000' } };
    expect(autoTheme('light', [DEFAULT_THEME, restyled]).tokens.accent).toBe('#ff0000');
  });
});
