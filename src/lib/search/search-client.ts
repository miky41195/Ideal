import { invoke } from '@tauri-apps/api/core';
import type { Match } from './group';

export interface FileList {
  files: string[];
  truncated: boolean;
}
export interface SearchOpts {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}
export interface SearchResult {
  matches: Match[];
  truncated: boolean;
  superseded: boolean;
}

export const projectFiles = (root: string) => invoke<FileList>('project_files', { root });
export const projectSearch = (root: string, query: string, opts: SearchOpts) =>
  invoke<SearchResult>('project_search', { root, query, opts });
