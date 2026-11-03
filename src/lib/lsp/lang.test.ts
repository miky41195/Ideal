import { describe, it, expect } from 'vitest';
import { languageIdFor, serverKeyFor } from './lang';

describe('languageIdFor', () => {
  const table: [string, string][] = [
    ['a.ts', 'typescript'], ['a.tsx', 'typescriptreact'], ['a.js', 'javascript'], ['a.mjs', 'javascript'],
    ['a.cjs', 'javascript'], ['a.jsx', 'javascriptreact'], ['a.html', 'html'], ['a.htm', 'html'],
    ['a.css', 'css'], ['a.scss', 'scss'], ['a.less', 'less'], ['a.json', 'json'], ['a.jsonc', 'jsonc'],
    ['a.py', 'python'], ['a.rs', 'rust'], ['a.go', 'go'], ['a.c', 'c'], ['a.h', 'c'], ['a.cpp', 'cpp'],
    ['a.cc', 'cpp'], ['a.cxx', 'cpp'], ['a.hpp', 'cpp'], ['a.hh', 'cpp'], ['a.java', 'java'],
  ];
  for (const [f, id] of table) it(`${f} -> ${id}`, () => expect(languageIdFor(f)).toBe(id));
  it('is case-insensitive and handles Windows paths', () => {
    expect(languageIdFor(['C:', 'p', 'A.TS'].join(String.fromCharCode(92)))).toBe('typescript');
  });
  it('unknown / no extension -> null', () => {
    expect(languageIdFor('README.md')).toBeNull();
    expect(languageIdFor('Makefile')).toBeNull();
    expect(languageIdFor('.gitignore')).toBeNull();
  });
});

describe('serverKeyFor mirrors servers.rs', () => {
  const ts = 'typescript-language-server';
  const css = 'vscode-css-language-server';
  const rows: [string, string][] = [
    ['typescript', ts], ['typescriptreact', ts], ['javascript', ts], ['javascriptreact', ts],
    ['html', 'vscode-html-language-server'], ['css', css], ['scss', css], ['less', css],
    ['json', 'vscode-json-language-server'], ['jsonc', 'vscode-json-language-server'],
    ['python', 'pyright-langserver'], ['rust', 'rust-analyzer'], ['go', 'gopls'],
    ['c', 'clangd'], ['cpp', 'clangd'], ['java', 'jdtls'],
  ];
  for (const [id, key] of rows) it(`${id} -> ${key}`, () => expect(serverKeyFor(id)).toBe(key));
  it('unknown -> null', () => expect(serverKeyFor('plaintext')).toBeNull());
});
