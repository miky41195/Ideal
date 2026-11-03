import { invoke } from '@tauri-apps/api/core';
import { readTextFile, type Eol } from '../fs-client';
import type { Tabs } from './tabs.svelte';

export interface Backup {
  filePath: string;
  content: string;
  eol: string;
  savedAt: number;
}

export const backupWrite = (projectPath: string, filePath: string, content: string, eol: string) =>
  invoke<void>('backup_write', { projectPath, filePath, content, eol });
export const backupClear = (projectPath: string, filePath: string) => invoke<void>('backup_clear', { projectPath, filePath });
export const backupList = (projectPath: string) => invoke<Backup[]>('backup_list', { projectPath });
export const backupClearAll = (projectPath: string) => invoke<void>('backup_clear_all', { projectPath });

export interface BackupSink {
  changed(path: string, content: string, eol: Eol): void;
  saved(path: string): void;
  discarded(path: string): void;
}

export interface BackupScheduler extends BackupSink {
  /** Writes every pending backup now; rejects if any write fails. */
  flush(): Promise<void>;
}

/** Per-path debounced backup writer. `saved`/`discarded` cancel the pending write and clear the backup. */
export function createBackupScheduler(
  write: (path: string, content: string, eol: Eol) => Promise<void>,
  clear: (path: string) => Promise<void>,
  delayMs = 1000,
): BackupScheduler {
  const pending = new Map<string, { content: string; eol: Eol; timer: ReturnType<typeof setTimeout> }>();
  // Operations on one path run in order, so a late write can never resurrect a cleared backup.
  const chains = new Map<string, Promise<unknown>>();
  const enqueue = (path: string, op: () => Promise<void>): Promise<void> => {
    const next = (chains.get(path) ?? Promise.resolve()).catch(() => {}).then(op);
    chains.set(path, next);
    return next;
  };
  const fire = (path: string): Promise<void> => {
    const p = pending.get(path);
    if (!p) return Promise.resolve();
    clearTimeout(p.timer);
    pending.delete(path);
    return enqueue(path, () => write(path, p.content, p.eol));
  };
  const drop = (path: string) => {
    const p = pending.get(path);
    if (p) clearTimeout(p.timer);
    pending.delete(path);
    void enqueue(path, () => clear(path)).catch(() => {});
  };
  return {
    changed(path, content, eol) {
      const p = pending.get(path);
      if (p) clearTimeout(p.timer);
      const timer = setTimeout(() => void fire(path).catch(() => {}), delayMs);
      pending.set(path, { content, eol, timer });
    },
    saved: drop,
    discarded: drop,
    async flush() {
      const results = await Promise.allSettled([...pending.keys()].map(fire));
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed) throw failed.reason;
      await Promise.all([...chains.values()]);
    },
  };
}

const isMissing = (e: unknown) => /os error (2|3)\b/.test(String(e));

/**
 * Re-opens backed-up buffers as dirty tabs measured against the CURRENT disk text
 * (a vanished file gets an empty baseline and is flagged deleted). Nothing is written to disk.
 * Returns how many tabs were restored.
 */
export async function restoreBackups(t: Tabs, backups: Backup[], clear?: (path: string) => void): Promise<number> {
  let n = 0;
  for (const b of backups) {
    let disk: string | null;
    let readonly = false;
    try {
      const f = await readTextFile(b.filePath);
      disk = f.content;
      readonly = f.readonly;
    } catch (e) {
      if (!isMissing(e)) continue; // unreadable right now: keep the backup for next time
      disk = null;
    }
    if (readonly) continue;
    if (disk !== null && disk === b.content) {
      clear?.(b.filePath); // stale backup: nothing unsaved
      continue;
    }
    t.openRestored(b.filePath, b.content, disk ?? '', b.eol === 'crlf' ? 'crlf' : 'lf', disk === null);
    n++;
  }
  return n;
}
