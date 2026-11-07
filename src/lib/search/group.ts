export interface Match {
  path: string;
  line: number;
  col: number;
  len: number;
  text: string;
  /** The match runs past `text`: `len` covers only part of it. */
  cut?: boolean;
}

export function groupMatches(matches: Match[]): { path: string; items: Match[] }[] {
  const by = new Map<string, Match[]>();
  for (const m of matches) {
    let a = by.get(m.path);
    if (!a) by.set(m.path, (a = []));
    a.push(m);
  }
  return [...by].map(([path, items]) => ({ path, items }));
}

/** Request tokens: only the most recently issued one is current. */
export function createLatest() {
  let n = 0;
  return {
    next: () => ++n,
    isCurrent: (tok: number) => tok === n,
  };
}

/**
 * `m.text` is a window of the line, so `m.col` is relative to it. Returns the column of the
 * match in the real line: the occurrence of the matched text nearest to the expected position, else 0.
 */
export function locateInLine(lineText: string, m: Match): number {
  const needle = m.text.slice(m.col, m.col + m.len);
  if (!needle) return 0;
  if (lineText === m.text) return m.col;
  const winAt = lineText.indexOf(m.text);
  if (winAt >= 0 && lineText.slice(winAt + m.col, winAt + m.col + m.len) === needle) return winAt + m.col;
  let best = -1;
  for (let i = lineText.indexOf(needle); i >= 0; i = lineText.indexOf(needle, i + 1)) {
    if (best < 0 || Math.abs(i - m.col) < Math.abs(best - m.col)) best = i;
    if (i > m.col + needle.length + 400 && best >= 0) break;
  }
  return best < 0 ? 0 : best;
}
