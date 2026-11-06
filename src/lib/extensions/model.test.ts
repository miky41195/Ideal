import { describe, expect, it } from 'vitest';
import { THEMES } from '../theme/themes';
import { parseExtensions } from './model';

const parse = (v: unknown) => parseExtensions(JSON.stringify(v));

describe('parseExtensions', () => {
  it('treats a missing or empty file as no extensions', () => {
    expect(parseExtensions(null)).toEqual({ themes: [], snippets: [], commands: [], errors: [] });
    expect(parseExtensions('  ').errors).toEqual([]);
  });

  it('reports broken files without failing', () => {
    expect(parseExtensions('{ nope').errors).toEqual(['extensions.json non valido']);
    expect(parseExtensions('[]').errors).toEqual(['extensions.json deve essere un oggetto']);
  });

  it('builds a theme over its base', () => {
    const { themes, errors } = parse({ themes: [{ id: 'mio', label: 'Mio', base: 'neve', accent: '#ff00aa', syntax: { keyword: '#112233' } }] });
    const neve = THEMES.find((t) => t.id === 'neve')!;
    expect(errors).toEqual([]);
    expect(themes[0]).toMatchObject({ id: 'mio', label: 'Mio', kind: neve.kind, accent: '#ff00aa', bg: neve.bg });
    expect(themes[0].syntax.keyword).toBe('#112233');
    expect(themes[0].syntax.string).toBe(neve.syntax.string);
    expect(neve.syntax.keyword).not.toBe('#112233');
  });

  it('uses the default base and the id as label', () => {
    expect(parse({ themes: [{ id: 'mio' }] }).themes[0]).toMatchObject({ id: 'mio', label: 'mio', bg: THEMES[0].bg });
  });

  it('refuses colours that are not plain hex, keeping the base value', () => {
    const { themes, errors } = parse({ themes: [{ id: 'x', accent: 'red;background:url(x)' }] });
    expect(themes[0].accent).toBe(THEMES[0].accent);
    expect(errors).toEqual(['tema x: accent deve essere #rrggbb']);
  });

  it('skips themes with bad, taken or repeated ids and unknown bases', () => {
    const { themes, errors } = parse({ themes: [{ id: 'a b' }, { id: 'neve' }, { id: 'ok' }, { id: 'ok' }, { id: 'z', base: 'nope' }] });
    expect(themes.map((t) => t.id)).toEqual(['ok']);
    expect(errors).toHaveLength(4);
  });

  it('reads snippets', () => {
    const { snippets, errors } = parse({ snippets: [{ prefix: 'log', body: 'console.log(${1})', languages: ['typescript', 3] }, { prefix: 'x' }] });
    expect(snippets).toEqual([{ prefix: 'log', body: 'console.log(${1})', label: 'log', languages: ['typescript'] }]);
    expect(errors).toEqual(['snippet senza prefix o body']);
  });

  it('reads commands', () => {
    const { commands, errors } = parse({ commands: [{ label: 'Build', run: 'npm run build' }, { label: 'x' }] });
    expect(commands).toEqual([{ label: 'Build', run: 'npm run build' }]);
    expect(errors).toEqual(['comando senza label o run']);
  });

  it('ignores sections of the wrong type', () => {
    expect(parse({ themes: 3, snippets: {}, commands: 'x' })).toEqual({ themes: [], snippets: [], commands: [], errors: [] });
  });
});
