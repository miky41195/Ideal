const EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'jsonc',
  py: 'python',
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  java: 'java',
};

export function languageIdFor(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

const TS = 'typescript-language-server';
const CSS = 'vscode-css-language-server';
const JSON_ = 'vscode-json-language-server';

/** Mirrors `server_key` in src-tauri/src/lsp/servers.rs: languages sharing a server share a key. */
const SERVER_KEY: Record<string, string> = {
  typescript: TS,
  typescriptreact: TS,
  javascript: TS,
  javascriptreact: TS,
  html: 'vscode-html-language-server',
  css: CSS,
  scss: CSS,
  less: CSS,
  json: JSON_,
  jsonc: JSON_,
  python: 'pyright-langserver',
  rust: 'rust-analyzer',
  go: 'gopls',
  c: 'clangd',
  cpp: 'clangd',
  java: 'jdtls',
};

export const serverKeyFor = (languageId: string): string | null => SERVER_KEY[languageId] ?? null;
