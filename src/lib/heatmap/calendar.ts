import type { DayCount } from '../git/git-client';

export type Level = 0 | 1 | 2 | 3 | 4;
export interface Cell {
  date: string;
  count: number;
  level: Level;
}

const DAY = 86400000;
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function levelFor(count: number, max: number): Level {
  if (count <= 0) return 0;
  if (max <= 0) return 1;
  return Math.min(4, Math.max(1, Math.ceil((4 * count) / max))) as Level;
}

/** Columns = weeks oldest→newest, rows = Mon..Sun; cells after `today` are null. UTC date math only. */
export function buildGrid(days: DayCount[], today: string, weeks = 53): (Cell | null)[][] {
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const max = days.reduce((m, d) => Math.max(m, d.count), 0);
  const todayMs = toMs(today);
  const dow = (new Date(todayMs).getUTCDay() + 6) % 7; // Mon=0
  const start = todayMs - dow * DAY - (weeks - 1) * 7 * DAY;
  const grid: (Cell | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: (Cell | null)[] = [];
    for (let r = 0; r < 7; r++) {
      const ms = start + (w * 7 + r) * DAY;
      if (ms > todayMs) {
        col.push(null);
        continue;
      }
      const date = toStr(ms);
      const count = counts.get(date) ?? 0;
      col.push({ date, count, level: levelFor(count, max) });
    }
    grid.push(col);
  }
  return grid;
}

/** Label at each column whose Monday falls in a month different from the previous column's. */
export function monthLabels(grid: (Cell | null)[][]): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  let prev = -1;
  grid.forEach((col, i) => {
    const first = col[0];
    if (!first) return;
    const m = Number(first.date.slice(5, 7)) - 1;
    if (i > 0 && prev !== -1 && m !== prev) out.push({ col: i, label: MONTHS[m] });
    prev = m;
  });
  return out;
}

/** "12 ottobre 2026" */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** "3 commit il 12 ottobre 2026" */
export function tooltipFor(date: string, count: number): string {
  return `${count} commit il ${longDate(date)}`;
}

/** Local-timezone YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
