import type { LanguageSupport } from '@codemirror/language';

type Loader = () => Promise<LanguageSupport>;

const js = (o?: { jsx?: boolean; typescript?: boolean }): Loader => async () =>
  (await import('@codemirror/lang-javascript')).javascript(o);

const BY_EXT: Record<string, Loader> = {
  ts: js({ typescript: true }),
  tsx: js({ typescript: true, jsx: true }),
  js: js(),
  mjs: js(),
  cjs: js(),
  jsx: js({ jsx: true }),
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  scss: async () => (await import('@codemirror/lang-css')).css(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  py: async () => (await import('@codemirror/lang-python')).python(),
  rs: async () => (await import('@codemirror/lang-rust')).rust(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  h: async () => (await import('@codemirror/lang-cpp')).cpp(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  hpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  md: async () => (await import('@codemirror/lang-markdown')).markdown(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  yml: async () => (await import('@codemirror/lang-yaml')).yaml(),
};

/** Resolve a CodeMirror language by file extension (lazy-loaded). */
export async function languageFor(path: string): Promise<LanguageSupport | null> {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  const load = BY_EXT[base.slice(dot + 1).toLowerCase()];
  return load ? load() : null;
}
