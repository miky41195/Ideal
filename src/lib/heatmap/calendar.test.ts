import { describe, it, expect } from 'vitest';
import { buildGrid, levelFor, monthLabels, longDate, tooltipFor } from './calendar';

describe('buildGrid', () => {
  const grid = buildGrid(
    [
      { date: '2026-10-30', count: 3 },
      { date: '2026-10-26', count: 1 },
      { date: '2025-11-03', count: 2 },
    ],
    '2026-10-30',
  );
  it('has 53 columns of 7 rows', () => {
    expect(grid).toHaveLength(53);
    expect(grid.every((c) => c.length === 7)).toBe(true);
  });
  it('last column: Mon..Fri filled, Sat/Sun null (today Friday)', () => {
    const last = grid[52];
    expect(last.slice(0, 5).every((c) => c !== null)).toBe(true);
    expect(last[5]).toBeNull();
    expect(last[6]).toBeNull();
    expect(last[4]?.date).toBe('2026-10-30');
    expect(last[0]?.date).toBe('2026-10-26');
  });
  it('maps counts to dates with levels', () => {
    expect(grid[52][4]).toEqual({ date: '2026-10-30', count: 3, level: 4 });
    expect(grid[52][0]).toEqual({ date: '2026-10-26', count: 1, level: 2 });
    expect(grid[52][1]?.count).toBe(0);
    const found = grid.flat().find((c) => c?.date === '2025-11-03');
    expect(found?.count).toBe(2);
    expect(found?.level).toBe(3);
  });
  it('first column starts on a Monday 52 weeks before', () => {
    expect(grid[0][0]?.date).toBe('2025-10-27');
  });
  it('is DST/leap safe: consecutive dates every day', () => {
    const dates = grid.flat().filter((c) => c).map((c) => c!.date);
    for (let i = 1; i < dates.length; i++) {
      const d = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000;
      expect(d).toBe(1);
    }
  });
  it('handles a leap-day window', () => {
    const g = buildGrid([], '2028-03-05');
    expect(g.flat().some((c) => c?.date === '2028-02-29')).toBe(true);
  });
});

describe('levelFor', () => {
  it('maps', () => {
    expect(levelFor(0, 8)).toBe(0);
    expect(levelFor(8, 8)).toBe(4);
    expect(levelFor(1, 8)).toBe(1);
    expect(levelFor(5, 8)).toBe(3);
    expect(levelFor(3, 0)).toBe(1);
    expect(levelFor(1, 1)).toBe(4);
  });
});

describe('monthLabels', () => {
  const grid = buildGrid([], '2026-10-30');
  const labels = monthLabels(grid);
  it('italian short months at changes only', () => {
    expect(labels.map((l) => l.label)).toEqual(['nov', 'dic', 'gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott']);
    expect(new Set(labels.map((l) => l.col)).size).toBe(labels.length);
  });
  it('first column labelled only if month starts there', () => {
    expect(labels[0].col).toBeGreaterThan(0);
  });
});

describe('longDate / tooltipFor', () => {
  it('formats Italian dates', () => {
    expect(longDate('2026-10-12')).toBe('12 ottobre 2026');
    expect(longDate('2026-03-01')).toBe('1 marzo 2026');
  });
  it('plural and singular', () => {
    expect(tooltipFor('2026-10-12', 3)).toBe('3 commit il 12 ottobre 2026');
    expect(tooltipFor('2026-10-12', 1)).toBe('1 commit il 12 ottobre 2026');
  });
});
