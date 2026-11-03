import { describe, it, expect } from 'vitest';
import { groupMatches, createLatest, locateInLine, type Match } from './group';

const m = (path: string, line: number, extra: Partial<Match> = {}): Match => ({ path, line, col: 0, len: 1, text: 'x', ...extra });

describe('groupMatches', () => {
  it('groups by file in order of first appearance', () => {
    const g = groupMatches([m('b', 1), m('a', 2), m('b', 3)]);
    expect(g.map((x) => x.path)).toEqual(['b', 'a']);
    expect(g[0].items.map((i) => i.line)).toEqual([1, 3]);
  });
  it('empty', () => expect(groupMatches([])).toEqual([]));
});

describe('createLatest', () => {
  it('only the newest token is current', () => {
    const l = createLatest();
    const a = l.next();
    const b = l.next();
    expect(l.isCurrent(a)).toBe(false);
    expect(l.isCurrent(b)).toBe(true);
  });
});

describe('locateInLine', () => {
  it('uses col directly when text is the whole line', () => {
    expect(locateInLine('foo bar', m('p', 1, { col: 4, len: 3, text: 'foo bar' }))).toBe(4);
  });
  it('finds the matched text in the real line when text is a window', () => {
    const line = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(10);
    const win = 'x'.repeat(20) + 'NEEDLE' + 'yyyy';
    expect(locateInLine(line, m('p', 1, { col: 20, len: 6, text: win }))).toBe(500);
  });
  it('picks the occurrence nearest to the expected position', () => {
    const line = 'ab ' + 'z'.repeat(400) + ' ab';
    expect(locateInLine(line, m('p', 1, { col: 1, len: 2, text: 'xab' }))).toBe(0);
    expect(locateInLine(line, m('p', 1, { col: 399, len: 2, text: 'q'.repeat(398) + 'xab' }))).toBe(404);
  });
  it('falls back to 0 when not found', () => {
    expect(locateInLine('nothing', m('p', 1, { col: 3, len: 2, text: 'qqqqq' }))).toBe(0);
  });
});
