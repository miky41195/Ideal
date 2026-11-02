import { invoke } from '@tauri-apps/api/core';
import { readTextFile, writeTextFile, createDir } from '../fs-client';

const sep = (p: string) => (p.includes('\\') ? '\\' : '/');
export const notesDir = (project: string) => `${project.replace(/[\\/]+$/, '')}${sep(project)}.ideal`;
export const notesPath = (project: string) => `${notesDir(project)}${sep(project)}notes.md`;

/** Returns file text ('' if missing) and its EOL. */
export async function loadNotes(project: string): Promise<{ md: string; eol: 'lf' | 'crlf' }> {
  try {
    const t = await readTextFile(notesPath(project));
    return { md: t.content, eol: t.eol };
  } catch {
    return { md: '', eol: 'lf' };
  }
}

export async function saveNotes(project: string, md: string, eol: 'lf' | 'crlf'): Promise<void> {
  await createDir(notesDir(project)).catch(() => {}); // exists already is fine
  await writeTextFile(notesPath(project), md, eol);
}

export function isIdealIgnored(project: string): Promise<boolean> {
  return invoke<boolean>('git_is_ignored', { path: project, file: '.ideal/notes.md' });
}

export function ignoreIdeal(project: string): Promise<void> {
  return invoke<void>('gitignore_add', { projectPath: project, entry: '.ideal/' });
}
