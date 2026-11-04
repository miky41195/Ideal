import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, resolveTheme, themeVars, xtermTheme } from './themes';

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('themes', () => {
  it('offers dark and light themes with unique ids', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES.filter((t) => t.kind === 'light').length).toBeGreaterThanOrEqual(2);
    expect(THEMES.filter((t) => t.kind === 'dark').length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the default for unknown and legacy ids', () => {
    expect(resolveTheme('ideal-dark').id).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME);
    expect(resolveTheme('bosco').id).toBe('bosco');
  });

  it('has a 16 colour terminal palette', () => {
    for (const t of THEMES) {
      expect(t.ansi).toHaveLength(16);
      expect(xtermTheme(t).brightWhite).toBe(t.ansi[15]);
    }
  });

  it('only produces valid custom properties', () => {
    for (const [k, v] of Object.entries(themeVars(THEMES[0]))) {
      expect(k.startsWith('--')).toBe(true);
      expect(v).toBeTruthy();
    }
  });

  describe.each(THEMES.map((t) => [t.id, t] as const))('%s contrast', (_id, t) => {
    it('keeps blocks visibly apart from the canvas', () => {
      expect(contrast(t.canvas, t.panel)).toBeGreaterThanOrEqual(1.2);
    });

    it.each([
      ['text on bg', t.text, t.bg],
      ['text on panel', t.text, t.panel],
      ['text on hover', t.text, t.panel2],
      ['dim on bg', t.textDim, t.bg],
      ['dim on panel', t.textDim, t.panel],
      ['canvas text', t.canvasText, t.canvas],
      ['canvas dim', t.canvasDim, t.canvas],
      ['accent label', t.accentFg, t.accent],
      ['danger on panel', t.danger, t.panel],
      ['success on panel', t.success, t.panel],
      ['warn on panel', t.warn, t.panel],
      ['keyword', t.syntax.keyword, t.bg],
      ['string', t.syntax.string, t.bg],
      ['number', t.syntax.number, t.bg],
      ['comment', t.syntax.comment, t.bg],
      ['func', t.syntax.func, t.bg],
      ['type', t.syntax.type, t.bg],
    ])('%s reaches 4.5:1', (_n, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
