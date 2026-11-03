import { settings } from '../settings/settings.svelte';

/** Display name of a shell program path: basename without extension; "terminale" when unset. */
export function shellName(program: string | null | undefined): string {
  if (!program) return 'terminale';
  const base = program.split(/[\\/]/).filter(Boolean).pop() ?? program;
  return base.replace(/\.exe$/i, '') || 'terminale';
}

export interface TerminalTab {
  id: number;
  title: string;
}

export class TerminalTabs {
  tabs = $state<TerminalTab[]>([]);
  active = $state(0);
  private counter = 0;

  constructor(private name: () => string) {
    this.add();
  }

  add(): number {
    const n = ++this.counter;
    this.tabs.push({ id: n, title: `${this.name()} ${n}` });
    this.active = n;
    return n;
  }

  select(id: number): void {
    if (this.tabs.some((t) => t.id === id)) this.active = id;
  }

  close(id: number): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.tabs.length === 0) {
      this.add();
      return;
    }
    if (this.active === id) this.active = this.tabs[Math.max(0, i - 1)].id;
  }
}

export const terminalTabs = new TerminalTabs(() => shellName(settings.value.terminal.shell));
