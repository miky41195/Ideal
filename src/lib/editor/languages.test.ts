import { describe, it, expect } from 'vitest';
import { languageFor } from './languages';

describe('languageFor', () => {
  it('resolves known extensions', async () => {
    expect(await languageFor('a.tsx')).not.toBeNull();
    expect(await languageFor('C:\\x\\b.rs')).not.toBeNull();
    expect(await languageFor('c.YAML')).not.toBeNull();
    for (const f of ['a.htm', 'a.jsonc', 'a.mts', 'a.cts', 'a.cc', 'a.cxx', 'a.hh', 'a.markdown'])
      expect(await languageFor(f)).not.toBeNull();
  });
  it('returns null for unknown files', async () => {
    expect(await languageFor('Makefile')).toBeNull();
    expect(await languageFor('x.toml')).toBeNull();
  });
});
