import { describe, it, expect } from 'vitest';
import { TerminalTabs, shellName } from './terminal-tabs.svelte';

describe('shellName', () => {
  it('uses the basename without .exe', () => {
    expect(shellName('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh');
    expect(shellName('/bin/bash')).toBe('bash');
    expect(shellName(null)).toBe('terminale');
  });
});

describe('TerminalTabs', () => {
  it('starts with one tab and adds numbered tabs', () => {
    const t = new TerminalTabs(() => 'pwsh');
    expect(t.tabs.map((x) => x.title)).toEqual(['pwsh 1']);
    t.add();
    expect(t.tabs.map((x) => x.title)).toEqual(['pwsh 1', 'pwsh 2']);
    expect(t.active).toBe(t.tabs[1].id);
  });
  it('never reuses a number', () => {
    const t = new TerminalTabs(() => 'pwsh');
    const two = t.add();
    t.close(two);
    t.add();
    expect(t.tabs.map((x) => x.title)).toEqual(['pwsh 1', 'pwsh 3']);
  });
  it('closing the active tab activates a neighbour', () => {
    const t = new TerminalTabs(() => 'sh');
    const b = t.add();
    const c = t.add();
    t.select(b);
    t.close(b);
    expect(t.active).toBe(t.tabs[0].id);
    t.select(c);
    expect(t.active).toBe(c);
  });
  it('closing a background tab keeps the active one', () => {
    const t = new TerminalTabs(() => 'sh');
    const first = t.tabs[0].id;
    t.add();
    t.close(first);
    expect(t.tabs).toHaveLength(1);
    expect(t.active).toBe(t.tabs[0].id);
  });
  it('closing the last tab creates a fresh one', () => {
    const t = new TerminalTabs(() => 'sh');
    const only = t.tabs[0].id;
    t.close(only);
    expect(t.tabs).toHaveLength(1);
    expect(t.tabs[0].id).not.toBe(only);
    expect(t.tabs[0].title).toBe('sh 2');
    expect(t.active).toBe(t.tabs[0].id);
  });
  it('select ignores unknown ids', () => {
    const t = new TerminalTabs(() => 'sh');
    const a = t.active;
    t.select(999);
    expect(t.active).toBe(a);
  });
});
