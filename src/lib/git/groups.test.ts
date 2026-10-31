import { describe, it, expect } from 'vitest';
import { groupFiles, statusLetter } from './groups';
import type { FileChange } from './git-client';

const fc = (path: string, group: string, index = '.', worktree = '.', origPath: string | null = null): FileChange => ({
  path, origPath, index, worktree, group,
});

describe('groupFiles', () => {
  it('splits by group, keeping a file in both staged and unstaged', () => {
    const g = groupFiles([
      fc('a.ts', 'staged', 'M', 'M'),
      fc('a.ts', 'unstaged', 'M', 'M'),
      fc('n.txt', 'untracked', '?', '?'),
      fc('c.ts', 'conflict', 'U', 'U'),
    ]);
    expect(g.staged.map((f) => f.path)).toEqual(['a.ts']);
    expect(g.unstaged.map((f) => f.path)).toEqual(['a.ts']);
    expect(g.untracked.map((f) => f.path)).toEqual(['n.txt']);
    expect(g.conflict.map((f) => f.path)).toEqual(['c.ts']);
  });

  it('sorts by path case-insensitively', () => {
    const g = groupFiles([fc('b.ts', 'unstaged', '.', 'M'), fc('A.ts', 'unstaged', '.', 'M'), fc('c.ts', 'unstaged', '.', 'M')]);
    expect(g.unstaged.map((f) => f.path)).toEqual(['A.ts', 'b.ts', 'c.ts']);
  });

  it('ignores unknown groups and handles empty', () => {
    expect(groupFiles([])).toEqual({ conflict: [], staged: [], unstaged: [], untracked: [] });
    expect(groupFiles([fc('x', 'weird')]).staged).toEqual([]);
  });
});

describe('statusLetter', () => {
  it('uses index letter for staged, worktree for unstaged', () => {
    expect(statusLetter(fc('a', 'staged', 'A', 'M'))).toBe('A');
    expect(statusLetter(fc('a', 'unstaged', 'A', 'M'))).toBe('M');
    expect(statusLetter(fc('a', 'unstaged', '.', 'D'))).toBe('D');
  });
  it('rename, untracked, conflict', () => {
    expect(statusLetter(fc('b', 'staged', 'R', '.', 'a'))).toBe('R');
    expect(statusLetter(fc('n', 'untracked', '?', '?'))).toBe('?');
    expect(statusLetter(fc('c', 'conflict', 'U', 'U'))).toBe('U');
  });
  it('maps other codes to M', () => {
    expect(statusLetter(fc('t', 'staged', 'T', '.'))).toBe('M');
  });
});
