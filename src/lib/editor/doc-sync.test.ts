import { describe, expect, it } from 'vitest';
import { minimalChange } from './doc-sync';

const apply = (s: string, c: { from: number; to: number; insert: string }) => s.slice(0, c.from) + c.insert + s.slice(c.to);

describe('minimalChange', () => {
  it('is null for equal text', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });

  it('finds an insertion', () => {
    expect(minimalChange('abcd', 'abXcd')).toEqual({ from: 2, to: 2, insert: 'X' });
  });

  it('finds a deletion', () => {
    expect(minimalChange('abXcd', 'abcd')).toEqual({ from: 2, to: 3, insert: '' });
  });

  it('handles repeats without overlapping prefix and suffix', () => {
    for (const [a, b] of [['aaa', 'aaaa'], ['aaaa', 'aaa'], ['', 'x'], ['x', ''], ['abab', 'ab']]) {
      expect(apply(a, minimalChange(a, b)!)).toBe(b);
    }
  });
});
