export interface NoteItem {
  line: number;
  done: boolean;
  text: string;
}

const ITEM = /^- \[( |x|X)\] ?(.*)$/;

/** Splits keeping each line's own EOL so every other line round-trips byte-for-byte. */
function split(md: string): { body: string; eol: string }[] {
  if (md === '') return [];
  return md.split(/(?<=\n)/).map((raw) => {
    const m = /^(.*?)(\r?\n)?$/s.exec(raw)!;
    return { body: m[1], eol: m[2] ?? '' };
  });
}

const join = (ls: { body: string; eol: string }[]) => ls.map((l) => l.body + l.eol).join('');
const flat = (t: string) => t.replace(/[\r\n]+/g, ' ').trim();

export function parseNotes(md: string): NoteItem[] {
  const items: NoteItem[] = [];
  split(md).forEach((l, line) => {
    const m = ITEM.exec(l.body);
    if (m) items.push({ line, done: m[1] !== ' ', text: m[2] });
  });
  return items;
}

function mapLine(md: string, line: number, fn: (body: string) => string | null): string {
  const ls = split(md);
  const l = ls[line];
  if (!l || !ITEM.test(l.body)) return md;
  const next = fn(l.body);
  if (next === null) ls.splice(line, 1);
  else l.body = next;
  return join(ls);
}

export function toggle(md: string, line: number): string {
  return mapLine(md, line, (b) => (/^- \[ \]/.test(b) ? b.replace('[ ]', '[x]') : b.replace(/\[[xX]\]/, '[ ]')));
}

export function removeItem(md: string, line: number): string {
  return mapLine(md, line, () => null);
}

export function editItem(md: string, line: number, text: string): string {
  const t = flat(text);
  if (!t) return md;
  return mapLine(md, line, (b) => `- [${ITEM.exec(b)![1]}] ${t}`);
}

export function addItem(md: string, text: string): string {
  const t = flat(text);
  if (!t) return md;
  if (md === '') return `- [ ] ${t}\n`;
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const base = /\r?\n$/.test(md) ? md : md + eol;
  return `${base}- [ ] ${t}${eol}`;
}
