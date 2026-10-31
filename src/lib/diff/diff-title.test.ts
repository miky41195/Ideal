import { describe, it, expect } from 'vitest';
import { diffTitle, STAGED_LABEL, UNSTAGED_LABEL } from './diff-title';

describe('diffTitle', () => {
  it('uses the file basename and label', () => {
    expect(diffTitle('src/a.ts', UNSTAGED_LABEL)).toBe('a.ts (Indice ↔ Lavoro)');
    expect(diffTitle('src\\lib\\a.ts', STAGED_LABEL)).toBe('a.ts (HEAD ↔ Indice)');
    expect(diffTitle('a.ts', 'abc1234')).toBe('a.ts (abc1234)');
  });
});
