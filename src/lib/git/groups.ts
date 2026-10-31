import type { FileChange } from './git-client';

export interface FileGroups {
  conflict: FileChange[];
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
}

const byPath = (a: FileChange, b: FileChange) =>
  a.path.toLowerCase().localeCompare(b.path.toLowerCase());

export function groupFiles(files: FileChange[]): FileGroups {
  const out: FileGroups = { conflict: [], staged: [], unstaged: [], untracked: [] };
  for (const f of files) {
    if (f.group === 'conflict') out.conflict.push(f);
    else if (f.group === 'staged') out.staged.push(f);
    else if (f.group === 'unstaged') out.unstaged.push(f);
    else if (f.group === 'untracked') out.untracked.push(f);
  }
  for (const k of Object.keys(out) as (keyof FileGroups)[]) out[k].sort(byPath);
  return out;
}

export function statusLetter(fc: FileChange): 'M' | 'A' | 'D' | 'R' | 'U' | '?' {
  if (fc.group === 'conflict') return 'U';
  if (fc.group === 'untracked') return '?';
  const c = fc.group === 'staged' ? fc.index : fc.worktree;
  return c === 'A' || c === 'D' || c === 'R' ? c : 'M';
}
