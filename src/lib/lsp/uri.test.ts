import { describe, it, expect } from 'vitest';
import { pathToUri, uriToPath, canonicalizeUris } from './uri';

const bs = String.fromCharCode(92);
const win = (...parts: string[]) => parts.join(bs);

describe('pathToUri', () => {
  it('encodes spaces per segment and keeps the drive colon', () => {
    expect(pathToUri(win('C:', 'Users', 'a b', 'x.ts'))).toBe('file:///C:/Users/a%20b/x.ts');
  });
  it('uppercases the drive letter', () => {
    expect(pathToUri(win('c:', 'p', 'x.ts'))).toBe('file:///C:/p/x.ts');
  });
  it('encodes unicode and #', () => {
    expect(pathToUri(win('C:', 'caffè#1', 'x.ts'))).toBe('file:///C:/caff%C3%A8%231/x.ts');
  });
  it('accepts forward slashes and posix paths', () => {
    expect(pathToUri('C:/p/x.ts')).toBe('file:///C:/p/x.ts');
    expect(pathToUri('/home/u/x.ts')).toBe('file:///home/u/x.ts');
  });
});

describe('uriToPath', () => {
  const cases = [
    win('C:', 'Users', 'a b', 'x.ts'),
    win('C:', 'caffè#1', 'x.ts'),
    win('D:', 'p', '100%', 'a+b.ts'),
  ];
  for (const p of cases) {
    it(`round-trips ${p}`, () => expect(uriToPath(pathToUri(p))).toBe(p));
  }
  it('handles server-style lowercase drive with encoded colon', () => {
    expect(uriToPath('file:///c%3A/Users/x.ts')).toBe(win('C:', 'Users', 'x.ts'));
  });
  it('posix round-trip', () => {
    expect(uriToPath(pathToUri('/home/u v/x.ts'))).toBe('/home/u v/x.ts');
  });
});

describe('canonicalizeUris', () => {
  it('rewrites server-style drive URIs to ours', () => {
    const raw = '{"method":"textDocument/publishDiagnostics","params":{"uri":"file:///c%3A/Users/a%20b/x.rs","diagnostics":[]}}';
    expect(canonicalizeUris(raw)).toBe('{"method":"textDocument/publishDiagnostics","params":{"uri":"file:///C:/Users/a%20b/x.rs","diagnostics":[]}}');
  });
  it('leaves canonical URIs and other text alone', () => {
    const raw = '{"uri":"file:///C:/p/a.ts","x":"file text"}';
    expect(canonicalizeUris(raw)).toBe(raw);
    expect(canonicalizeUris('{"a":1}')).toBe('{"a":1}');
  });
});
