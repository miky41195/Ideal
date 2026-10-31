import { describe, it, expect } from 'vitest';
import { languageFor } from './languages';

describe('languageFor', () => {
  it('resolves known extensions', async () => {
    expect(await languageFor('a.tsx')).not.toBeNull();
    expect(await languageFor('C:\\x\\b.rs')).not.toBeNull();
    expect(await languageFor('c.YAML')).not.toBeNull();
  });
  it('returns null for unknown files', async () => {
    expect(await languageFor('Makefile')).toBeNull();
    expect(await languageFor('x.toml')).toBeNull();
  });
});
