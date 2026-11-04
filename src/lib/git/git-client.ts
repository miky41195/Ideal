import { invoke } from '@tauri-apps/api/core';

export interface FileChange {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  group: string;
}

export interface RepoStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
}

export interface Branch {
  name: string;
  current: boolean;
  upstream: string | null;
}

export interface DiffText {
  old: string;
  new: string;
  binary: boolean;
}

export interface CommitInfo {
  hash: string;
  short: string;
  subject: string;
  author: string;
  email: string;
  time: number;
  additions: number;
  deletions: number;
  files: number;
}

export interface CommitFile {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number | null;
  deletions: number | null;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface Heatmap {
  days: DayCount[];
  max: number;
  email: string | null;
}

export const gitStatus = (path: string) => invoke<RepoStatus>('git_status', { path });
export const gitStage = (path: string, files: string[]) => invoke<void>('git_stage', { path, files });
export const gitUnstage = (path: string, files: string[]) => invoke<void>('git_unstage', { path, files });
export const gitDiscard = (path: string, files: string[]) => invoke<void>('git_discard', { path, files });
export const gitCommit = (path: string, message: string) => invoke<string>('git_commit', { path, message });
export const gitBranches = (path: string) => invoke<Branch[]>('git_branches', { path });
export const gitSwitch = (path: string, name: string) => invoke<void>('git_switch', { path, name });
export const gitCreateBranch = (path: string, name: string) =>
  invoke<void>('git_create_branch', { path, name });
export const gitFetch = (path: string) => invoke<void>('git_fetch', { path });
export const gitPull = (path: string) => invoke<void>('git_pull', { path });
export const gitPush = (path: string) => invoke<void>('git_push', { path });
export const gitFileDiff = (path: string, file: string, staged: boolean, oldPath: string | null = null) =>
  invoke<DiffText>('git_file_diff', { path, file, staged, oldPath });
export const gitCommitFiles = (path: string, hash: string) =>
  invoke<CommitFile[]>('git_commit_files', { path, hash });
export const gitCommitFileDiff = (path: string, hash: string, file: string, oldPath: string | null) =>
  invoke<DiffText>('git_commit_file_diff', { path, hash, file, oldPath });
export const gitHeatmap = (path: string, allAuthors: boolean) =>
  invoke<Heatmap>('git_heatmap', { path, allAuthors });
export const gitDayCommits = (path: string, date: string, allAuthors: boolean) =>
  invoke<CommitInfo[]>('git_day_commits', { path, date, allAuthors });
/** Repo root containing `path` (null outside a repo). */
export const gitToplevel = (path: string) => invoke<string | null>('git_toplevel', { path });
export const gitWatch = (path: string) => invoke<void>('git_watch', { path });
