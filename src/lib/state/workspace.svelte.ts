export type Mode = 'claude' | 'editor';
export type SidebarView = 'explorer' | 'git' | 'heatmap' | 'notes' | 'hub';
export type ClaudeTabKind = 'new' | 'continue' | 'resume';

export interface ClaudeTab {
  id: string;
  ptyId?: number;
  title: string;
  kind: ClaudeTabKind;
  resumeId?: string;
}

export class Workspace {
  mode = $state<Mode>('claude');
  claudeTabs = $state<ClaudeTab[]>([]);
  activeClaudeId = $state<string | null>(null);
  sidebarView = $state<SidebarView | null>('explorer');
  panelOpen = $state(true);

  #counter = 0;

  constructor() {
    this.addClaudeTab('new');
  }

  get activeClaudeTab(): ClaudeTab | undefined {
    return this.claudeTabs.find((t) => t.id === this.activeClaudeId);
  }

  toggleMode(): void {
    this.mode = this.mode === 'claude' ? 'editor' : 'claude';
  }

  showClaude(): void {
    this.mode = 'claude';
  }

  showEditor(): void {
    this.mode = 'editor';
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen;
  }

  addClaudeTab(kind: ClaudeTabKind = 'new', resumeId?: string): ClaudeTab {
    this.#counter += 1;
    const tab: ClaudeTab = { id: `claude-${this.#counter}`, title: `Claude ${this.#counter}`, kind, resumeId };
    this.claudeTabs.push(tab);
    this.activeClaudeId = tab.id;
    return this.claudeTabs[this.claudeTabs.length - 1];
  }

  selectClaudeTab(id: string): void {
    if (this.claudeTabs.some((t) => t.id === id)) this.activeClaudeId = id;
  }

  closeClaudeTab(id: string): void {
    const i = this.claudeTabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.claudeTabs.splice(i, 1);
    if (this.activeClaudeId === id) {
      this.activeClaudeId = this.claudeTabs[Math.max(0, i - 1)]?.id ?? null;
    }
  }
}

export const workspace = new Workspace();
