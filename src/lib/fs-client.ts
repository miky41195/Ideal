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
