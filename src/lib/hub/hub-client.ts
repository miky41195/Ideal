import { invoke } from '@tauri-apps/api/core';

export interface MemObservation {
  id: number;
  project: string;
  kind: string;
  title: string;
  subtitle: string | null;
  narrative: string | null;
  facts: string[];
  filesModified: string[];
  createdAtEpoch: number;
}

export interface MemSummary {
  id: number;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  nextSteps: string | null;
  createdAtEpoch: number;
}

export interface MemPage<T> {
  items: T[];
  hasMore: boolean;
}

export interface SessionMeta {
  id: string;
  title: string;
  started: number;
  updated: number;
  entries: number;
}

export interface TranscriptEntry {
  kind: string;
  text: string;
  tool: string | null;
  ts: number;
}

export interface TranscriptPage {
  entries: TranscriptEntry[];
  total: number;
}

export interface MdFile {
  name: string;
  path: string;
  updated: number;
}

export interface PluginStatus {
  claudeMem: boolean;
  caveman: boolean;
}

export const memHealth = (port: number) => invoke<boolean>('mem_health', { port });
export const memObservations = (port: number, project: string, offset: number, limit: number) =>
  invoke<MemPage<MemObservation>>('mem_observations', { port, project, offset, limit });
export const memSummaries = (port: number, project: string, offset: number, limit: number) =>
  invoke<MemPage<MemSummary>>('mem_summaries', { port, project, offset, limit });
export const memSearch = (port: number, project: string, query: string) =>
  invoke<string>('mem_search', { port, project, query });
export const memStartWorker = () => invoke<void>('mem_start_worker');
export const sessionsList = (projectPath: string) => invoke<SessionMeta[]>('sessions_list', { projectPath });
export const sessionRead = (projectPath: string, id: string, offset: number, limit: number) =>
  invoke<TranscriptPage>('session_read', { projectPath, id, offset, limit });
export const memoriesList = (projectPath: string) => invoke<MdFile[]>('memories_list', { projectPath });
export const docsList = (projectPath: string) => invoke<MdFile[]>('docs_list', { projectPath });
export const pluginsStatus = () => invoke<PluginStatus>('plugins_status');
export const pluginEnable = (key: string) => invoke<void>('plugin_enable', { key });
