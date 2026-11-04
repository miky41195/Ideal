<script lang="ts">
  import type { Mode } from '../state/workspace.svelte';
  import { health } from '../hub/health.svelte';
  import { tabs, isFileTab } from '../editor/tabs.svelte';
  import { languageName } from '../editor/languages';
  import { lsp } from '../lsp/lsp-manager.svelte';
  import { languageIdFor, serverKeyFor } from '../lsp/lang';
  import { lspStatusText } from '../lsp/status';
  let { mode }: { mode: Mode } = $props();
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
  {#if health.mem === 'down'}
    <button class="mem down" title="Avvia claude-mem" onclick={() => void health.ensureWorker()}>
      <span class="dot"></span>claude-mem spento, clic per avviare
    </button>
  {:else if health.mem !== 'unknown'}
    <span class="mem {health.mem}"><span class="dot"></span>{health.mem === 'up' ? 'claude-mem attivo' : 'claude-mem in avvio…'}</span>
  {/if}
</footer>

<style>
  footer {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: flex-end;
    flex: none;
    height: 24px;
    padding: 0 10px;
    color: var(--canvas-dim);
    font-size: 12px;
  }
  footer button {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: inherit;
  }
  footer button:hover:not(:disabled) {
    background: none;
    color: var(--canvas-text);
  }
  .mem {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--canvas-dim);
  }
  .mem.up .dot {
    background: var(--success);
  }
  .mem.down .dot {
    background: var(--danger);
  }
  .mem.starting .dot {
    background: var(--warn);
  }
</style>
