const norm = (s: string) => s.split(String.fromCharCode(92)).join('/').toLowerCase();
const isBoundary = (c: string | undefined) => c === undefined || c === '/' || c === '_' || c === '-' || c === '.';

function scoreFrom(q: string, c: string, start: number, baseStart: number): number | null {
  let score = 0;
  let ci = start;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const at = c.indexOf(q[qi], ci);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 5;
    if (isBoundary(c[at - 1])) score += 4;
    if (qi === 0 && at === baseStart) score += 10;
    prev = at;
    ci = at + 1;
  }
  return score;
}

/** Case-insensitive subsequence score; null if not all chars match. Higher is better. */
export function fuzzyScore(query: string, candidate: string): number | null {
  const q = norm(query);
  const c = norm(candidate);
  if (!q) return 0;
  const baseStart = c.lastIndexOf('/') + 1;
  let best = scoreFrom(q, c, 0, baseStart);
  if (best === null) return null;
  if (baseStart > 0) {
    const alt = scoreFrom(q, c, baseStart, baseStart);
    if (alt !== null && alt > best) best = alt;
  }
  return best - c.length * 0.01;
}

export function rankPaths(query: string, paths: string[], limit = 50): string[] {
  if (!query.trim()) return paths.slice(0, limit);
  const scored: { p: string; s: number }[] = [];
  for (const p of paths) {
    const s = fuzzyScore(query, p);
    if (s !== null) scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.p);
}
