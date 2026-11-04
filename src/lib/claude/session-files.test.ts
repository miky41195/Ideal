import { describe, expect, it } from 'vitest';
import { relativeTo } from './session-files';

describe('relativeTo', () => {
  it('gives a slash path inside the root, ignoring drive case', () => {
    expect(relativeTo('C:\\Users\\a\\Ideal', 'c:\\Users\\a\\Ideal\\src\\App.svelte')).toBe('src/App.svelte');
    expect(relativeTo('C:/p/', 'C:/p/x.ts')).toBe('x.ts');
  });

  it('is null outside the root, including a sibling with the same prefix', () => {
    expect(relativeTo('C:/p', 'C:/other/x.ts')).toBeNull();
    expect(relativeTo('C:/p', 'C:/p2/x.ts')).toBeNull();
    expect(relativeTo('C:/p', 'C:/p')).toBeNull();
  });
});
