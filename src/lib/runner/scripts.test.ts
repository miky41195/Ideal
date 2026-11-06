import { describe, expect, it } from 'vitest';
import { packageManager, parseScripts, runLine } from './scripts';

describe('parseScripts', () => {
  it('lists scripts in file order', () => {
    const text = JSON.stringify({ scripts: { dev: 'vite', 'test:unit': 'vitest run' } });
    expect(parseScripts(text)).toEqual([
      { name: 'dev', command: 'vite' },
      { name: 'test:unit', command: 'vitest run' },
    ]);
  });

  it('gives an empty list without scripts and null for broken text', () => {
    expect(parseScripts('{}')).toEqual([]);
    expect(parseScripts('{ nope')).toBeNull();
    expect(parseScripts('3')).toBeNull();
  });

  it('drops names that could reach the shell as code', () => {
    const text = JSON.stringify({ scripts: { 'a; rm -rf x': 'y', 'b$(c)': 'y', 'd e': 'y', ok: 'y', bad: 5 } });
    expect(parseScripts(text)?.map((s) => s.name)).toEqual(['ok']);
  });
});

describe('packageManager', () => {
  it('prefers the packageManager field', () => {
    expect(packageManager('{"packageManager":"pnpm@9.1.0"}', ['yarn.lock'])).toBe('pnpm');
  });

  it('falls back to the lockfile, then npm', () => {
    expect(packageManager('{}', ['yarn.lock'])).toBe('yarn');
    expect(packageManager('{}', ['bun.lockb'])).toBe('bun');
    expect(packageManager('{}', ['package-lock.json'])).toBe('npm');
    expect(packageManager('{"packageManager":"weird@1"}', [])).toBe('npm');
  });
});

describe('runLine', () => {
  it('builds the command', () => {
    expect(runLine('pnpm', 'dev')).toBe('pnpm run dev');
  });
});
