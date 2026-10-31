import { readTextFile, writeTextFile, type Eol } from '../fs-client';

export type TabKind = 'file' | 'diff' | 'heatmap';

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
  name: string;
  content: string;
  savedContent: string;
  eol: Eol;
  readonly: boolean;
  reason?: string;
  /** File/folder deleted on disk while the tab had unsaved edits; saving recreates it. */
  orphaned?: boolean;
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

const HEATMAP_ID = 'heatmap:';
const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export class Tabs {
  tabs = $state<EditorTab[]>([]);
  activePath = $state<string | null>(null);
  /** Save errors, per path; cleared only by that path's successful save or close. */
  errors = $state<Record<string, string>>({});
  openError = $state<string | null>(null);
  private lastFilePath: string | null = null;
  private retargetListeners = new Set<(from: string, to: string) => void>();

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
      if (this.activePath === t.path) this.activePath = this.tabs[Math.max(0, j - 1)]?.path ?? null;
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

  openHeatmap(): void {
    this.noteFile();
    if (!this.tabs.some((t) => t.path === HEATMAP_ID)) {
      this.tabs.push({ path: HEATMAP_ID, kind: 'heatmap', name: 'Heatmap', content: '', savedContent: '', eol: 'lf', readonly: true });
    }
    this.activePath = HEATMAP_ID;
  }

  async openFile(path: string): Promise<void> {
    if (this.tabs.some((t) => t.path === path && isFileTab(t))) {
      this.noteFile();
      this.activePath = path;
      return;
    }
    this.noteFile();
    try {
      const f = await readTextFile(path);
      if (!this.tabs.some((t) => t.path === path && isFileTab(t))) {
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
      }
      this.activePath = path;
      this.openError = null;
    } catch (e) {
      this.openError = `Impossibile aprire ${nameOf(path)}: ${String(e)}`;
    }
  }

  setContent(path: string, content: string): void {
    const t = this.tabs.find((x) => x.path === path);
    if (t && !t.readonly) t.content = content;
  }

  async closeTab(path: string, confirmDirty: (name: string) => Promise<boolean>): Promise<void> {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    const tab = this.tabs[i];
    if (dirty(tab) && !(await confirmDirty(tab.name))) return;
    const j = this.tabs.findIndex((t) => t.path === path);
    if (j < 0) return;
    this.tabs.splice(j, 1);
    delete this.errors[path];
    if (this.activePath === path) this.activePath = this.tabs[Math.max(0, j - 1)]?.path ?? null;
  }

  async save(path: string): Promise<void> {
    const t = this.tabs.find((x) => x.path === path);
    if (!t || t.readonly || !isFileTab(t)) return;
    const snapshot = t.content;
    try {
      await writeTextFile(path, snapshot, t.eol);
      t.savedContent = snapshot;
      t.orphaned = false;
      delete this.errors[path];
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
