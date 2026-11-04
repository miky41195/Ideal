export type Mode = 'claude' | 'editor';
export type ClaudeTabKind = 'new' | 'continue' | 'resume';

export interface ClaudeTab {
  id: string;
  ptyId?: number;
  title: string;
  kind: ClaudeTabKind;
  resumeId?: string;
  /** Transcript id, known up front for new sessions and resumes; `continue` picks the newest. */
  sessionId?: string;
}

export class Workspace {
  mode = $state<Mode>('claude');
  /** Bumps on every explicit ask to show Claude or the editor, even when the mode is already right. */
  reveal = $state(0);
  claudeTabs = $state<ClaudeTab[]>([]);
  activeClaudeId = $state<string | null>(null);

  #counter = 0;

  constructor() {
    this.addClaudeTab('new');
  }

  get activeClaudeTab(): ClaudeTab | undefined {
    return this.claudeTabs.find((t) => t.id === this.activeClaudeId);
  }

  toggleMode(): void {
    this.mode = this.mode === 'claude' ? 'editor' : 'claude';
    this.reveal += 1;
  }

  showClaude(): void {
    this.mode = 'claude';
    this.reveal += 1;
  }

  showEditor(): void {
    this.mode = 'editor';
    this.reveal += 1;
  }

  addClaudeTab(kind: ClaudeTabKind = 'new', resumeId?: string): ClaudeTab {
    this.#counter += 1;
    const sessionId = kind === 'new' ? crypto.randomUUID() : resumeId;
    const tab: ClaudeTab = { id: `claude-${this.#counter}`, title: `Claude ${this.#counter}`, kind, resumeId, sessionId };
    this.claudeTabs.push(tab);
    this.activeClaudeId = tab.id;
    return this.claudeTabs[this.claudeTabs.length - 1];
  }

  /** A restarted new session cannot reuse its id: Claude refuses one already taken. */
  renewSession(id: string): void {
    const t = this.claudeTabs.find((x) => x.id === id);
    if (t?.kind === 'new') t.sessionId = crypto.randomUUID();
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
