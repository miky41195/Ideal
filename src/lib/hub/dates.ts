const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "oggi 14:32", "ieri", "12 ott", "12 ott 2025" (local time). Empty for missing/invalid. */
export function relativeDate(epochMs: number, nowMs: number = Date.now()): string {
  if (!epochMs || !Number.isFinite(epochMs)) return '';
  const d = new Date(epochMs);
  const now = new Date(nowMs);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `oggi ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 1) return 'ieri';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
