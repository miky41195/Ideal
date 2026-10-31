import { readTextFile, writeTextFile, type Eol } from '../fs-client';

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  eol: Eol;
  readonly: boolean;
  reason?: string;
}

export const dirty = (tab: EditorTab): boolean => tab.content !== tab.savedContent;

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export class Tabs {
  tabs = $state<EditorTab[]>([]);
  activePath = $state<string | null>(null);
  error = $state<string | null>(null);

  get active(): EditorTab | undefined {
    return this.tabs.find((t) => t.path === this.activePath);
  }

  select(path: string): void {
    if (this.tabs.some((t) => t.path === path)) this.activePath = path;
  }

  async openFile(path: string): Promise<void> {
    if (this.tabs.some((t) => t.path === path)) {
      this.activePath = path;
      return;
    }
    try {
      const f = await readTextFile(path);
      if (!this.tabs.some((t) => t.path === path)) {
        this.tabs.push({
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
      this.error = null;
    } catch (e) {
      this.error = `Impossibile aprire ${nameOf(path)}: ${String(e)}`;
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
    if (this.activePath === path) this.activePath = this.tabs[Math.max(0, j - 1)]?.path ?? null;
  }

  async save(path: string): Promise<void> {
    const t = this.tabs.find((x) => x.path === path);
    if (!t || t.readonly) return;
    const snapshot = t.content;
    try {
      await writeTextFile(path, snapshot, t.eol);
      t.savedContent = snapshot;
      this.error = null;
    } catch (e) {
      this.error = `Salvataggio di ${t.name} non riuscito: ${String(e)}`;
    }
  }

  async saveAll(): Promise<void> {
    for (const t of this.tabs) if (dirty(t)) await this.save(t.path);
  }
}

export const tabs = new Tabs();
export const openFile = (path: string) => tabs.openFile(path);
