import { readTextFile, writeTextFile, type Eol } from '../fs-client';
import { decideDiskChange } from './disk-policy';
import { showToast } from '../ui/toast.svelte';
import type { BackupSink } from './hot-exit';
import { lsp } from '../lsp/lsp-manager.svelte';
import { setFileOpener } from '../lsp/jump';

export type TabKind = 'file' | 'diff' | 'heatmap' | 'doc' | 'transcript';

export interface DiffData {
  old: string;
  new: string;
  binary: boolean;
  langPath: string;
}

export interface EditorTab {
  /** Tab key: the file path for files, a synthetic id (`diff:...`, `heatmap:`) otherwise. */
  path: string;
  /** Defaults to 'file'. */
  kind?: TabKind;
  diff?: DiffData;
  doc?: { markdown: string; sourcePath?: string };
  transcript?: { projectPath: string; sessionId: string; title: string };
  name: string;
  content: string;
  savedContent: string;
  eol: Eol;
  readonly: boolean;
  reason?: string;
  /** File/folder deleted on disk while the tab had unsaved edits; saving recreates it. */
  orphaned?: boolean;
  /** Disk text (LF) of a file that changed on disk while the buffer had unsaved edits; shows the banner. */
  diskConflict?: string;
  /** Line endings of `diskConflict`, applied if the user takes the disk version. */
  diskEol?: Eol;
  /** Bumped when the editor must replace its document with `content` (external reload). */
  reloadToken?: number;
  /** One-shot request for the editor to select a range and scroll to it; consumed (cleared) by CodeEditor. */
  revealRequest?: RevealRequest;
}

export interface RevealRequest {
  /** 1-based line. */
  line: number;
  col: number;
  len: number;
}

export const isFileTab = (tab: EditorTab): boolean => (tab.kind ?? 'file') === 'file';

export const dirty = (tab: EditorTab): boolean => isFileTab(tab) && tab.content !== tab.savedContent;

export const hasUnsaved = (tabs: EditorTab[]): boolean => tabs.some(dirty);

/** Maps `p` through a rename of `from` to `to` (file itself or anything under it); null if unaffected. */
export function remapPath(p: string, from: string, to: string): string | null {
  if (p === from) return to;
  if (p.startsWith(from) && (p[from.length] === '\\' || p[from.length] === '/')) return to + p.slice(from.length);
  return null;
}

const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const samePath = (a: string, b: string) => normPath(a) === normPath(b);

const HEATMAP_ID = 'heatmap:';
const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export class Tabs {
  tabs = $state<EditorTab[]>([]);
  activePath = $state<string | null>(null);
  /** Save errors, per path; cleared only by that path's successful save or close. */
  errors = $state<Record<string, string>>({});
  openError = $state<string | null>(null);
  /** Current single-line editor selection (empty if none); used to prefill find-in-project. */
  selectionHint = '';
  /** Cursor of the active editor, 1-based line and column (chars); updated at most once per frame. */
  cursor = $state<{ line: number; col: number } | null>(null);
  /** File of a side editor holding the keyboard: Ctrl+S saves this one instead of the active tab. */
  focusPath: string | null = null;
  private lastFilePath: string | null = null;
  private diskJobs = new Map<string, { pending: boolean; done: Promise<void> }>();
  private backup: BackupSink | null = null;
  private savedListeners = new Set<() => void>();
  private retargetListeners = new Set<(from: string, to: string) => void>();

  /** Hot-exit hook: told when a file buffer becomes dirty, clean again, or is thrown away. */
  setBackupSink(sink: BackupSink | null): void {
    this.backup = sink;
  }

  private noteBackup(t: EditorTab): void {
    if (!this.backup || !isFileTab(t) || t.readonly) return;
    if (dirty(t)) this.backup.changed(t.path, t.content, t.eol);
    else this.backup.saved(t.path);
  }

  /** Opens a tab restored from a hot-exit backup: `content` (backup) is dirty against `savedContent` (current disk text). */
  openRestored(path: string, content: string, savedContent: string, eol: Eol, deleted: boolean): void {
    if (this.fileTab(path)) return;
    this.tabs.push({ kind: 'file', path, name: nameOf(path), content, savedContent, eol, readonly: false, orphaned: deleted || undefined });
    lsp.opened(path);
    if (this.activePath === null) this.activePath = path;
  }

  /** Notified after a file was saved successfully (e.g. to refresh git status). */
  onSaved(fn: () => void): () => void {
    this.savedListeners.add(fn);
    return () => this.savedListeners.delete(fn);
  }

  /** Notified after tabs are retargeted (lets editors move per-path caches). */
  onRetarget(fn: (from: string, to: string) => void): () => void {
    this.retargetListeners.add(fn);
    return () => this.retargetListeners.delete(fn);
  }

  /** A file or folder was renamed/moved on disk: follow it in open tabs. */
  retarget(from: string, to: string): void {
    for (const t of this.tabs) {
      if (!isFileTab(t)) continue;
      const np = remapPath(t.path, from, to);
      if (np === null) continue;
      const old = t.path;
      t.path = np;
      t.name = nameOf(np);
      lsp.closed(old);
      lsp.opened(np);
      if (this.backup) {
        this.backup.discarded(old); // old-path backup must not be restored
        this.noteBackup(t);
      }
      if (old in this.errors) {
        this.errors[np] = this.errors[old];
        delete this.errors[old];
      }
      if (this.activePath === old) this.activePath = np;
      if (this.lastFilePath === old) this.lastFilePath = np;
    }
    for (const fn of this.retargetListeners) fn(from, to);
  }

  /** A file or folder was deleted on disk: close clean tabs, keep dirty ones flagged. */
  orphan(path: string): void {
    for (const t of [...this.tabs]) {
      if (!isFileTab(t) || remapPath(t.path, path, path) === null) continue;
      if (dirty(t)) {
        t.orphaned = true;
        continue;
      }
      const j = this.tabs.findIndex((x) => x.path === t.path);
      this.tabs.splice(j, 1);
      delete this.errors[t.path];
      this.backup?.saved(t.path); // clean tab gone: no backup should linger
      lsp.closed(t.path);
      if (this.activePath === t.path) this.activePath = this.tabs[Math.max(0, j - 1)]?.path ?? null;
    }
  }

  /** Opens (or refreshes and focuses) a diff of the disk text (left) against the buffer (right). */
  openCompare(path: string, diskText: string, bufferText: string): void {
    this.openDiff(`diff:disk:${path}`, `${nameOf(path)} ↔ disco`, { old: diskText, new: bufferText, binary: false, langPath: path });
  }

  /** Banner action: take the disk version, dropping the buffer's edits. */
  reloadFromDisk(path: string): void {
    const t = this.tabs.find((x) => x.path === path && isFileTab(x));
    if (!t || t.diskConflict === undefined) return;
    if (t.diskEol) t.eol = t.diskEol;
    this.applyReload(t, t.diskConflict);
  }

  /** Banner action: keep the buffer; disk becomes the saved baseline so the next save overwrites knowingly. */
  keepMine(path: string): void {
    const t = this.tabs.find((x) => x.path === path && isFileTab(x));
    if (!t || t.diskConflict === undefined) return;
    t.savedContent = t.diskConflict;
    t.diskConflict = undefined;
    this.noteBackup(t);
  }

  private applyReload(t: EditorTab, disk: string): void {
    t.content = disk;
    t.savedContent = disk;
    t.diskConflict = undefined;
    t.orphaned = false;
    delete this.errors[t.path];
    t.reloadToken = (t.reloadToken ?? 0) + 1;
    this.noteBackup(t);
  }

  /** Files changed on disk (absolute paths): re-read the open ones and apply the external-change policy. */
  async onDiskChanged(paths: string[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const t of this.tabs) {
      if (!isFileTab(t) || !paths.some((p) => samePath(p, t.path))) continue;
      jobs.push(this.diskJob(t.path));
    }
    await Promise.all(jobs);
  }

  /** Serialized per path: a change arriving during a read just schedules one more read (latest wins). */
  private diskJob(path: string): Promise<void> {
    const running = this.diskJobs.get(path);
    if (running) {
      running.pending = true;
      return running.done;
    }
    const job = { pending: false, done: Promise.resolve() };
    job.done = (async () => {
      try {
        do {
          job.pending = false;
          await this.checkDisk(path);
        } while (job.pending);
      } finally {
        this.diskJobs.delete(path);
      }
    })();
    this.diskJobs.set(path, job);
    return job.done;
  }

  /** Delay before re-checking a path that looked missing (atomic rewrites leave it briefly absent). */
  recheckDelayMs = 300;

  private async readDisk(path: string): Promise<{ text: string; eol: Eol } | { readonly: string } | 'missing' | 'error'> {
    try {
      const f = await readTextFile(path);
      if (f.readonly) return { readonly: f.reason ?? 'non modificabile' };
      return { text: f.content, eol: f.eol };
    } catch (e) {
      return /os error (2|3)\b/.test(String(e)) ? 'missing' : 'error';
    }
  }

  private async checkDisk(path: string): Promise<void> {
    let r = await this.readDisk(path);
    if (r === 'missing') {
      await new Promise((res) => setTimeout(res, this.recheckDelayMs));
      r = await this.readDisk(path);
    }
    const cur = this.tabs.find((x) => x.path === path && isFileTab(x));
    if (!cur || r === 'error') return; // unreadable right now (sharing violation...): keep the tab as is
    if (typeof r === 'object' && 'readonly' in r) {
      // Binary / too large / not UTF-8 now: its "content" is not the file text, never load it.
      const reason = r.readonly;
      if (dirty(cur)) showToast('File su disco non più leggibile come testo');
      else {
        cur.readonly = true;
        cur.reason = reason;
      }
      return;
    }
    const disk = r === 'missing' ? null : (r as { text: string }).text;
    switch (decideDiskChange(cur, disk)) {
      case 'ignore':
        if (disk !== null && disk !== cur.savedContent) cur.savedContent = disk; // dirty buffer already equals disk
        this.noteBackup(cur);
        cur.diskConflict = undefined;
        break;
      case 'reload':
        cur.eol = (r as { eol: Eol }).eol;
        this.applyReload(cur, disk!);
        break;
      case 'conflict':
        cur.diskConflict = disk!;
        cur.diskEol = (r as { eol: Eol }).eol;
        break;
      case 'deleted':
        this.orphan(path);
        break;
    }
  }

  get active(): EditorTab | undefined {
    return this.tabs.find((t) => t.path === this.activePath);
  }

  /** Active tab if it is a file, else the last active file tab (so the editor keeps its state behind diff/heatmap tabs). */
  get activeFileTab(): EditorTab | undefined {
    const a = this.active;
    if (a && isFileTab(a)) return a;
    return this.tabs.find((t) => t.path === this.lastFilePath && isFileTab(t)) ?? this.tabs.find(isFileTab);
  }

  private noteFile(): void {
    const a = this.active;
    if (a && isFileTab(a)) this.lastFilePath = a.path;
  }

  select(path: string): void {
    if (this.tabs.some((t) => t.path === path)) {
      this.noteFile();
      this.activePath = path;
    }
  }

  /** Opens (or refreshes and focuses) a read-only diff tab keyed by `id`. */
  openDiff(id: string, title: string, diff: DiffData): void {
    this.noteFile();
    const existing = this.tabs.find((t) => t.path === id);
    if (existing) {
      existing.diff = diff;
      existing.name = title;
    } else {
      this.tabs.push({ path: id, kind: 'diff', diff, name: title, content: '', savedContent: '', eol: 'lf', readonly: true });
    }
    this.activePath = id;
  }

  /** Opens (or refreshes and focuses) a read-only rendered-markdown tab keyed by `id`. */
  openDoc(id: string, title: string, markdown: string, sourcePath?: string): void {
    this.noteFile();
    const existing = this.tabs.find((t) => t.path === id && t.kind === 'doc');
    if (existing) {
      existing.doc = { markdown, sourcePath };
      existing.name = title;
    } else {
      this.tabs.push({ path: id, kind: 'doc', doc: { markdown, sourcePath }, name: title, content: '', savedContent: '', eol: 'lf', readonly: true });
    }
    this.activePath = id;
  }

  openTranscript(projectPath: string, meta: { id: string; title: string }): void {
    this.noteFile();
    const id = `transcript:${meta.id}`;
    if (!this.tabs.some((t) => t.path === id)) {
      this.tabs.push({
        path: id,
        kind: 'transcript',
        transcript: { projectPath, sessionId: meta.id, title: meta.title },
        name: meta.title,
        content: '',
        savedContent: '',
        eol: 'lf',
        readonly: true,
      });
    }
    this.activePath = id;
  }

  openHeatmap(): void {
    this.noteFile();
    if (!this.tabs.some((t) => t.path === HEATMAP_ID)) {
      this.tabs.push({ path: HEATMAP_ID, kind: 'heatmap', name: 'Heatmap', content: '', savedContent: '', eol: 'lf', readonly: true });
    }
    this.activePath = HEATMAP_ID;
  }

  /** Open file tab of `path`, whatever its spelling (drive case, `/` or `\`): one buffer per file. */
  private fileTab(path: string): EditorTab | undefined {
    return this.tabs.find((t) => isFileTab(t) && samePath(t.path, path));
  }

  async openFile(path: string): Promise<void> {
    const open = this.fileTab(path);
    if (open) {
      this.noteFile();
      this.activePath = open.path;
      return;
    }
    this.noteFile();
    try {
      const f = await readTextFile(path);
      const raced = this.fileTab(path);
      if (raced) path = raced.path;
      else {
        this.tabs.push({
          kind: 'file',
          path,
          name: nameOf(path),
          content: f.content,
          savedContent: f.content,
          eol: f.eol,
          readonly: f.readonly,
          reason: f.reason ?? undefined,
        });
        lsp.opened(path);
      }
      this.activePath = path;
      this.openError = null;
    } catch (e) {
      this.openError = `Impossibile aprire ${nameOf(path)}: ${String(e)}`;
    }
  }

  /** Opens `path` if needed, then asks the editor to select `[col, col+len)` on 1-based `line`. */
  async reveal(path: string, line: number, col = 0, len = 0): Promise<void> {
    await this.openFile(path);
    const t = this.fileTab(path);
    if (!t) return;
    t.revealRequest = { line, col, len };
    this.activePath = t.path;
  }

  setContent(path: string, content: string): void {
    const t = this.tabs.find((x) => x.path === path);
    if (t && !t.readonly) {
      t.content = content;
      this.noteBackup(t);
    }
  }

  async closeTab(path: string, confirmDirty: (name: string) => Promise<boolean>): Promise<void> {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    const tab = this.tabs[i];
    if (dirty(tab) && !(await confirmDirty(tab.name))) return;
    const j = this.tabs.findIndex((t) => t.path === path);
    if (j < 0) return;
    const wasDirty = dirty(tab);
    this.tabs.splice(j, 1);
    delete this.errors[path];
    if (wasDirty && isFileTab(tab)) this.backup?.discarded(path);
    if (isFileTab(tab)) lsp.closed(path);
    if (this.activePath === path) this.activePath = this.tabs[Math.max(0, j - 1)]?.path ?? null;
  }

  async save(path: string): Promise<void> {
    const t = this.tabs.find((x) => x.path === path);
    if (!t || t.readonly || !isFileTab(t)) return;
    if (t.diskConflict !== undefined) {
      // Saving now would silently overwrite the newer disk version (often Claude's edits).
      this.errors[path] = `${t.name} è cambiato su disco: scegli Ricarica, Tieni il mio o Confronta prima di salvare`;
      return;
    }
    const snapshot = t.content;
    try {
      await writeTextFile(path, snapshot, t.eol);
      t.savedContent = snapshot;
      t.orphaned = false;
      delete this.errors[path];
      this.noteBackup(t); // clean now (or edited again while saving)
      lsp.saved(path);
      this.savedListeners.forEach((f) => f());
    } catch (e) {
      this.errors[path] = `Salvataggio di ${t.name} non riuscito: ${String(e)}`;
    }
  }

  /** First current error to display (save errors of open tabs, else open error). */
  get errorMessage(): string | null {
    for (const t of this.tabs) if (this.errors[t.path]) return this.errors[t.path];
    return this.openError;
  }

  dismissError(): void {
    this.openError = null;
    this.errors = {};
  }

  async saveAll(): Promise<void> {
    for (const t of this.tabs) if (dirty(t)) await this.save(t.path);
  }
}

export const tabs = new Tabs();
export const openFile = (path: string) => tabs.openFile(path);

setFileOpener({
  async read(path) {
    await tabs.openFile(path);
    const t = tabs.tabs.find((x) => isFileTab(x) && samePath(x.path, path));
    return t ? t.content : null;
  },
  reveal: (path, line, col) => void tabs.reveal(path, line, col),
});
