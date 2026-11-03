import { describe, it, expect } from 'vitest';
import { fuzzyScore, rankPaths } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches subsequences, null on miss', () => {
    expect(fuzzyScore('abc', 'a_b_c')).not.toBeNull();
    expect(fuzzyScore('abd', 'abc')).toBeNull();
    expect(fuzzyScore('cba', 'abc')).toBeNull();
  });
  it('is case-insensitive', () => {
    expect(fuzzyScore('APP', 'src/app.ts')).not.toBeNull();
  });
  it('basename start beats mid path', () => {
    expect(fuzzyScore('app', 'src/app.ts')!).toBeGreaterThan(fuzzyScore('app', 'application/zzz/x.ts')!);
  });
  it('consecutive beats scattered', () => {
    expect(fuzzyScore('abc', 'xabcx')!).toBeGreaterThan(fuzzyScore('abc', 'xaxbxcx')!);
  });
  it('shorter candidate wins ties', () => {
    expect(fuzzyScore('foo', 'foo.ts')!).toBeGreaterThan(fuzzyScore('foo', 'foo.test.ts')!);
  });
  it('normalizes backslashes', () => {
    const bs = String.fromCharCode(92);
    expect(fuzzyScore('src/app', `src${bs}app.ts`)).toBe(fuzzyScore('src/app', 'src/app.ts'));
    expect(fuzzyScore(`src${bs}app`, 'src/app.ts')).not.toBeNull();
  });
});

describe('rankPaths', () => {
  const paths = ['src/main.ts', 'src/app.ts', 'README.md', 'docs/app-guide.md'];
  it('empty query returns first limit unchanged', () => {
    expect(rankPaths('', paths, 2)).toEqual(['src/main.ts', 'src/app.ts']);
  });
  it('ranks and limits', () => {
    expect(rankPaths('app', paths)[0]).toBe('src/app.ts');
    expect(rankPaths('app', paths)).not.toContain('README.md');
    expect(rankPaths('a', paths, 1)).toHaveLength(1);
  });
});
