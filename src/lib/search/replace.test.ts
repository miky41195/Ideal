import { describe, expect, it } from 'vitest';
import type { Match } from './group';
import { replaceMatches } from './replace';

const at = (line: number, text: string, needle: string, from = 0): Match => ({ path: 'a', line, col: text.indexOf(needle, from), len: needle.length, text });

describe('replaceMatches', () => {
  it('replaces one match', () => {
    const r = replaceMatches('const a = 1;\nfoo(a);\n', [at(2, 'foo(a);', 'foo')], 'bar');
    expect(r).toEqual({ text: 'const a = 1;\nbar(a);\n', done: 1, skipped: 0 });
  });

  it('handles several matches on a line, in any order', () => {
    const line = 'foo foo foo';
    const ms = [at(1, line, 'foo', 4), at(1, line, 'foo', 8), at(1, line, 'foo', 0)];
    expect(replaceMatches(line, ms, 'longer')).toEqual({ text: 'longer longer longer', done: 3, skipped: 0 });
  });

  it('keeps working when the replacement holds the search text', () => {
    expect(replaceMatches('a a', [at(1, 'a a', 'a', 0), at(1, 'a a', 'a', 2)], 'aa').text).toBe('aa aa');
  });

  it('treats dollar signs in the replacement as plain text', () => {
    expect(replaceMatches('foo', [at(1, 'foo', 'foo')], '$& $1').text).toBe('$& $1');
  });

  it('skips a match that moved away instead of damaging the line', () => {
    const r = replaceMatches('nothing here\n', [at(1, 'foo bar', 'foo')], 'x');
    expect(r).toEqual({ text: 'nothing here\n', done: 0, skipped: 1 });
  });

  it('skips a line that no longer exists', () => {
    const r = replaceMatches('one', [at(9, 'foo', 'foo')], 'x');
    expect(r).toEqual({ text: 'one', done: 0, skipped: 1 });
  });

  it('finds the match when the line shifted sideways', () => {
    const r = replaceMatches('    foo();', [at(1, 'foo();', 'foo')], 'bar');
    expect(r).toEqual({ text: '    bar();', done: 1, skipped: 0 });
  });

  it('does not touch other lines', () => {
    const r = replaceMatches('foo\nfoo\nfoo', [at(2, 'foo', 'foo')], 'x');
    expect(r.text).toBe('foo\nx\nfoo');
  });
});
