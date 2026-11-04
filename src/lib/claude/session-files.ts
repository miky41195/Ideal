import { invoke } from '@tauri-apps/api/core';

export interface SessionFile {
  path: string;
  /** Times Claude edited it in this session. */
  edits: number;
}

/** Files Claude changed in a session, most recent first. */
export const sessionFiles = (projectPath: string, id: string | null) =>
  invoke<SessionFile[]>('session_files', { projectPath, id });

/** Path inside `root` with forward slashes, as git reports it; null when the file is outside. */
export function relativeTo(root: string, path: string): string | null {
  const norm = (s: string) => s.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '');
  const r = norm(root);
  const p = norm(path);
  if (p.length <= r.length || p[r.length] !== '/') return null;
  return p.slice(0, r.length).toLowerCase() === r.toLowerCase() ? p.slice(r.length + 1) : null;
}
