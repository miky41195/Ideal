<script lang="ts">
  import type { Mode } from '../state/workspace.svelte';
  import { git } from '../git/git-store.svelte';
  import { workspace } from '../state/workspace.svelte';
  import { health } from '../hub/health.svelte';
  import { tabs, isFileTab } from '../editor/tabs.svelte';
  import { languageName } from '../editor/languages';
  import { lsp } from '../lsp/lsp-manager.svelte';
  import { languageIdFor, serverKeyFor } from '../lsp/lang';
  import { lspStatusText } from '../lsp/status';
  let { mode, path }: { mode: Mode; path: string } = $props();
  const fileTab = $derived(mode === 'editor' && tabs.active && isFileTab(tabs.active) ? tabs.active : null);
  const lspKey = $derived.by(() => {
    const id = fileTab ? languageIdFor(fileTab.path) : null;
    return id ? serverKeyFor(id) : null;
  });
  const lspState = $derived(lspKey ? lsp.state[lspKey] : undefined);
  const lspText = $derived(fileTab ? lspStatusText(lspState, languageName(fileTab.path)) : null);
  function lspClick() {
    if (!lspKey) return;
    if (lspState === 'missing') lsp.showMissing(lspKey);
    else if (lspState === 'error') lsp.retry(lspKey);
  }
</script>

<footer>
  <span>{mode === 'claude' ? '✦ Claude' : '✎ Editor'}</span>
  <span class="path" title={path}>{path}</span>
  {#if fileTab}
    <span>{languageName(fileTab.path)}</span>
    {#if tabs.cursor}<span>Ln {tabs.cursor.line}, Col {tabs.cursor.col}</span>{/if}
    {#if lspText}
      {#if lspState === 'missing' || lspState === 'error'}
        <button class="lsp" title={lspState === 'missing' ? 'Mostra come installarlo' : 'Riprova ad avviare il server'} onclick={lspClick}>{lspText}</button>
      {:else}
        <span>{lspText}</span>
      {/if}
    {/if}
  {/if}
  {#if git.status?.isRepo && git.status.branch}
    <button class="branch" title="Apri Git" onclick={() => (workspace.sidebarView = 'git')}>
      ⎇ {git.status.branch}{#if git.status.upstream}{#if git.status.ahead} ↑{git.status.ahead}{/if}{#if git.status.behind} ↓{git.status.behind}{/if}{/if}
    </button>
  {/if}
  <button
    class="mem {health.mem}"
    disabled={health.mem === 'starting' || health.mem === 'up'}
    title={health.mem === 'up' ? 'claude-mem attivo' : health.mem === 'starting' ? 'avvio…' : 'claude-mem spento — clic per avviare'}
    onclick={() => void health.ensureWorker()}
  >
    <span class="dot">●</span>
    {health.mem === 'up' ? 'claude-mem attivo' : health.mem === 'starting' ? 'avvio…' : health.mem === 'down' ? 'claude-mem spento — clic per avviare' : ''}
  </button>
</footer>

<style>
  footer {
    display: flex;
    gap: 16px;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
  }
  .lsp {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .branch {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .branch:hover {
    text-decoration: underline;
  }
  .mem {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    padding: 0;
    cursor: pointer;
  }
  .mem:disabled {
    cursor: default;
  }
  .mem.unknown {
    display: none;
  }
  .mem.up .dot {
    color: #4ade80;
  }
  .mem.down .dot {
    color: #f87171;
  }
  .mem.starting .dot {
    color: #fbbf24;
  }
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
