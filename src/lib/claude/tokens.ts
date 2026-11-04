/** A local estimate, not a tokenizer: close enough to tell a short message from a long one. */
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  const t = text.trim();
  return t ? Math.ceil(t.length / CHARS_PER_TOKEN) : 0;
}

const it1 = (n: number) => n.toFixed(1).replace('.', ',').replace(',0', '');

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${it1(n / 1000)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${it1(n / 1_000_000)}M`;
}

export type ContextLevel = 'ok' | 'warn' | 'high';

/** `warn` is the owner's threshold; twice that is high. Zero turns the warning off. */
export function contextLevel(tokens: number | null, warn: number): ContextLevel {
  if (tokens === null || warn <= 0 || tokens < warn) return 'ok';
  return tokens >= warn * 2 ? 'high' : 'warn';
}

export interface ScreenRow {
  text: string;
  /** The row's first character is drawn dim, as Claude draws its placeholder. */
  dim: boolean;
}

/** What Claude's own Remote Control panel says, when it is on screen. */
export function remoteFromScreen(rows: ScreenRow[]): boolean | null {
  const text = rows.map((r) => r.text).join('\n');
  if (text.includes('Enable Remote Control')) return false;
  if (text.includes('This session is available in the Claude mobile app')) return true;
  return null;
}

/**
 * Best knowledge of the link, surest first: the panel, then the transcript, then the startup setting.
 * A new session has no transcript until its first message, so the setting has to cover that gap.
 */
export function remoteState(screen: boolean | null, hasLink: boolean, atStartup: boolean): boolean {
  return screen ?? (hasLink || atStartup);
}

const isRule = (s: string) => (s.match(/─/g)?.length ?? 0) >= 20;

/** Finds what is typed in Claude's input box on screen: the rows between its two horizontal rules. */
export function extractDraft(rows: ScreenRow[]): string {
  const bottom = rows.findLastIndex((r) => isRule(r.text));
  if (bottom < 1) return '';
  const top = rows.slice(0, bottom).findLastIndex((r) => isRule(r.text));
  if (top < 0) return '';
  const inside = rows.slice(top + 1, bottom);
  if (inside[0]?.dim) return '';
  const lines = inside.map((r) =>
    r.text
      .replace(/^\s*│\s?/, '')
      .replace(/\s*│\s*$/, '')
      .replace(/^>\s?/, '')
      .trim(),
  );
  const text = lines.join('\n').trim();
  return /^Try ".*"$/.test(text) ? '' : text;
}
