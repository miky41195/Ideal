import { describe, expect, it } from 'vitest';
import { relativeDate } from './dates';

const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

describe('relativeDate', () => {
  const now = at(2026, 10, 31, 18, 0);
  it('oggi con orario', () => expect(relativeDate(at(2026, 10, 31, 14, 32), now)).toBe('oggi 14:32'));
  it('oggi zero-padded', () => expect(relativeDate(at(2026, 10, 31, 9, 5), now)).toBe('oggi 09:05'));
  it('ieri', () => expect(relativeDate(at(2026, 10, 30, 23, 59), now)).toBe('ieri'));
  it('stesso anno', () => expect(relativeDate(at(2026, 10, 12, 10), now)).toBe('12 ott'));
  it('altro anno', () => expect(relativeDate(at(2025, 10, 12, 10), now)).toBe('12 ott 2025'));
  it('ieri a cavallo di mese', () => expect(relativeDate(at(2026, 9, 30, 12), at(2026, 10, 1, 8))).toBe('ieri'));
  it('zero o non valido', () => expect(relativeDate(0, now)).toBe(''));
});
