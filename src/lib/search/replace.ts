import { locateInLine, type Match } from './group';

export interface Replaced {
  text: string;
  done: number;
  /** Matches whose text is no longer where the search found it. */
  skipped: number;
}

/**
 * Swaps the matches of one file for `replacement`. The search reads the disk, so the text here
 * may be newer: every match is checked against the line before anything changes.
 */
export function replaceMatches(text: string, matches: Match[], replacement: string): Replaced {
  const lines = text.split('\n');
  let done = 0;
  let skipped = 0;
  const byLine = new Map<number, Match[]>();
  for (const m of matches) {
    // Only part of a cut match is known: replacing it would leave its tail behind.
    if (m.cut) skipped++;
    else byLine.set(m.line, [...(byLine.get(m.line) ?? []), m]);
  }

  for (const [number, found] of byLine) {
    const line = lines[number - 1];
    if (line === undefined) {
      skipped += found.length;
      continue;
    }
    const spots = found
      .map((m) => ({ at: locateInLine(line, m), len: m.len, needle: m.text.slice(m.col, m.col + m.len) }))
      .sort((a, b) => b.at - a.at);
    let next = line;
    let limit = Infinity;
    for (const { at, len, needle } of spots) {
      if (at + len > limit || line.slice(at, at + len) !== needle) {
        skipped++;
        continue;
      }
      next = next.slice(0, at) + replacement + next.slice(at + len);
      limit = at;
      done++;
    }
    lines[number - 1] = next;
  }
  return { text: lines.join('\n'), done, skipped };
}
