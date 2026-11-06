import { THEMES, type Syntax, type Theme } from '../theme/themes';

export interface UserSnippet {
  prefix: string;
  body: string;
  label: string;
  /** Language ids it applies to; empty means every file. */
  languages: string[];
}

export interface UserCommand {
  label: string;
  run: string;
}

export interface Extensions {
  themes: Theme[];
  snippets: UserSnippet[];
  commands: UserCommand[];
  errors: string[];
}

const COLOR = /^#[0-9a-f]{6}$/i;
const THEME_ID = /^[a-z0-9-]+$/i;
const COLOR_KEYS = ['canvas', 'canvasText', 'canvasDim', 'bg', 'panel', 'panel2', 'border', 'text', 'textDim', 'accent', 'accentFg', 'danger', 'success', 'warn'] as const;
const SYNTAX_KEYS = ['keyword', 'string', 'number', 'comment', 'func', 'type'] as const;

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseTheme(raw: unknown, taken: Set<string>, errors: string[]): Theme | null {
  const t = record(raw);
  if (!t || !isText(t.id) || !THEME_ID.test(t.id)) {
    errors.push('tema senza id valido');
    return null;
  }
  if (taken.has(t.id)) {
    errors.push(`tema ${t.id}: id già usato`);
    return null;
  }
  const base = THEMES.find((x) => x.id === (t.base ?? 'grafite'));
  if (!base) {
    errors.push(`tema ${t.id}: base sconosciuta`);
    return null;
  }
  const theme: Theme = { ...base, id: t.id, label: isText(t.label) ? t.label : t.id, syntax: { ...base.syntax } };
  // These values end up in CSS and in the window title colour, which both need plain #rrggbb.
  const color = (key: string, value: unknown, set: (c: string) => void) => {
    if (value === undefined) return;
    if (typeof value === 'string' && COLOR.test(value)) set(value);
    else errors.push(`tema ${t.id}: ${key} deve essere #rrggbb`);
  };
  for (const k of COLOR_KEYS) color(k, t[k], (c) => (theme[k] = c));
  const syntax = record(t.syntax);
  if (syntax) for (const k of SYNTAX_KEYS) color(`syntax.${k}`, syntax[k], (c) => ((theme.syntax as Syntax)[k] = c));
  taken.add(t.id);
  return theme;
}

function parseSnippet(raw: unknown, errors: string[]): UserSnippet | null {
  const s = record(raw);
  if (!s || !isText(s.prefix) || !isText(s.body)) {
    errors.push('snippet senza prefix o body');
    return null;
  }
  const languages = Array.isArray(s.languages) ? s.languages.filter(isText) : [];
  return { prefix: s.prefix, body: s.body, label: isText(s.label) ? s.label : s.prefix, languages };
}

function parseCommand(raw: unknown, errors: string[]): UserCommand | null {
  const c = record(raw);
  if (!c || !isText(c.label) || !isText(c.run)) {
    errors.push('comando senza label o run');
    return null;
  }
  return { label: c.label, run: c.run };
}

const list = <T>(value: unknown, parse: (raw: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(parse).filter((x): x is T => x !== null) : [];

/** Reads extensions.json; a bad entry is reported and skipped, never fatal. */
export function parseExtensions(text: string | null): Extensions {
  const empty: Extensions = { themes: [], snippets: [], commands: [], errors: [] };
  if (!text?.trim()) return empty;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ...empty, errors: ['extensions.json non valido'] };
  }
  const root = record(json);
  if (!root) return { ...empty, errors: ['extensions.json deve essere un oggetto'] };
  const errors: string[] = [];
  const taken = new Set(THEMES.map((t) => t.id));
  return {
    themes: list(root.themes, (r) => parseTheme(r, taken, errors)),
    snippets: list(root.snippets, (r) => parseSnippet(r, errors)),
    commands: list(root.commands, (r) => parseCommand(r, errors)),
    errors,
  };
}
