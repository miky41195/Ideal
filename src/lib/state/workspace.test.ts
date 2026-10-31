import { describe, it, expect, beforeEach } from 'vitest';
import { Workspace } from './workspace.svelte';

describe('Workspace', () => {
  let w: Workspace;
  beforeEach(() => {
    w = new Workspace();
  });

  it('starts in claude mode with one tab', () => {
    expect(w.mode).toBe('claude');
    expect(w.claudeTabs).toHaveLength(1);
    expect(w.claudeTabs[0].title).toBe('Claude 1');
    expect(w.claudeTabs[0].kind).toBe('new');
    expect(w.activeClaudeTab?.id).toBe(w.claudeTabs[0].id);
  });

  it('toggleMode twice returns to claude', () => {
    w.toggleMode();
    expect(w.mode).toBe('editor');
    w.toggleMode();
    expect(w.mode).toBe('claude');
  });

  it('addClaudeTab continue adds an active tab titled Claude 2', () => {
    const t = w.addClaudeTab('continue');
    expect(w.claudeTabs).toHaveLength(2);
    expect(t.title).toBe('Claude 2');
    expect(w.activeClaudeTab?.id).toBe(t.id);
    expect(t.kind).toBe('continue');
  });

  it('closing the active tab activates the previous one', () => {
    const first = w.claudeTabs[0];
    const second = w.addClaudeTab();
    w.closeClaudeTab(second.id);
    expect(w.activeClaudeTab?.id).toBe(first.id);
  });

  it('closing the last tab leaves none', () => {
    w.closeClaudeTab(w.claudeTabs[0].id);
    expect(w.claudeTabs).toHaveLength(0);
    expect(w.activeClaudeTab).toBeUndefined();
  });

  it('titles keep increasing after closes', () => {
    w.closeClaudeTab(w.claudeTabs[0].id);
    expect(w.addClaudeTab().title).toBe('Claude 2');
  });

  it('defaults for panel and sidebar', () => {
    expect(w.panelOpen).toBe(true);
    expect(w.sidebarView).toBe('explorer');
    w.togglePanel();
    expect(w.panelOpen).toBe(false);
  });

  it('closing a non-active tab keeps the active one', () => {
    const first = w.claudeTabs[0];
    const second = w.addClaudeTab();
    w.closeClaudeTab(first.id);
    expect(w.activeClaudeTab?.id).toBe(second.id);
  });

  it('selectClaudeTab ignores unknown ids', () => {
    const before = w.activeClaudeId;
    w.selectClaudeTab('nope');
    expect(w.activeClaudeId).toBe(before);
  });

  it('showClaude sets claude mode', () => {
    w.toggleMode();
    w.showClaude();
    expect(w.mode).toBe('claude');
  });
});
