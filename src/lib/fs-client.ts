import { invoke } from '@tauri-apps/api/core';

export type Eol = 'lf' | 'crlf';

export interface TextFile {
  content: string;
  eol: Eol;
  readonly: boolean;
  reason: string | null;
}

export function readTextFile(path: string): Promise<TextFile> {
  return invoke<TextFile>('read_text_file', { path });
}

export function writeTextFile(path: string, content: string, eol: Eol): Promise<void> {
  return invoke<void>('write_text_file', { path, content, eol });
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface RawDirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function listDir(path: string): Promise<DirEntry[]> {
  const raw = await invoke<RawDirEntry[]>('list_dir', { path });
  return raw.map((e) => ({ name: e.name, path: e.path, isDir: e.is_dir }));
}

export function createFile(path: string): Promise<void> {
  return invoke<void>('create_file', { path });
}

export function createDir(path: string): Promise<void> {
  return invoke<void>('create_dir', { path });
}

export function renamePath(from: string, to: string): Promise<void> {
  return invoke<void>('rename_path', { from, to });
}

/** Moves the path to the recycle bin. */
export function deletePath(path: string): Promise<void> {
  return invoke<void>('delete_path', { path });
}
