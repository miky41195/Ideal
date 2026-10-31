<script lang="ts">
  import { onMount } from 'svelte';
  import { ask } from '@tauri-apps/plugin-dialog';
  import { onCommand } from '../commands';
  import { tabs, dirty, isFileTab } from './tabs.svelte';
  import DiffView from '../diff/DiffView.svelte';
  import HeatmapView from '../heatmap/HeatmapView.svelte';
  import CodeEditor from './CodeEditor.svelte';

  let { visible = true }: { visible?: boolean } = $props();

  const confirmClose = (name: string) => ask(`Chiudere ${name} senza salvare?`, { title: 'Ideal', kind: 'warning' });

  async function close(path: string) {
    await tabs.closeTab(path, confirmClose);
  }

  onMount(() => {
    const offs = [
      onCommand('save', () => tabs.activePath && void tabs.save(tabs.activePath)),
      onCommand('saveAll', () => void tabs.saveAll()),
      onCommand('closeTab', () => tabs.activePath && void close(tabs.activePath)),
    ];
    return () => offs.forEach((f) => f());
  });
</script>

<div class="area">
  <div class="strip" role="tablist">
    {#each tabs.tabs as t (t.path)}
      <div class="tab" class:active={t.path === tabs.activePath} role="presentation">
        <button class="label" role="tab" aria-selected={t.path === tabs.activePath} title={isFileTab(t) ? t.path : t.name} onclick={() => tabs.select(t.path)}>
          {t.name}{#if t.orphaned}<span class="orph"> (eliminato)</span>{/if}{#if dirty(t)}<span class="dot" aria-label="modificato"> ●</span>{/if}
        </button>
        <button class="x" aria-label={`Chiudi ${t.name}`} onclick={() => close(t.path)}>×</button>
      </div>
    {/each}
  </div>
  {#if tabs.errorMessage}
    <div class="err" role="alert">
      <span>{tabs.errorMessage}</span>
      <button class="x" aria-label="Chiudi messaggio" onclick={() => tabs.dismissError()}>×</button>
    </div>
  {/if}
  {#if tabs.active}
    {@const onFile = tabs.active === tabs.activeFileTab}
    {#if onFile && tabs.active.readonly}
      <div class="banner">Sola lettura: {tabs.active.reason ?? 'non modificabile'}</div>
    {/if}
    <div class="main">
      {#if tabs.activeFileTab}
        <div class="body" class:hidden={!onFile}>
          <CodeEditor tab={tabs.activeFileTab} visible={visible && onFile} isOpen={(p) => tabs.tabs.some((t) => t.path === p && isFileTab(t))} onchange={(p, c) => tabs.setContent(p, c)} />
        </div>
      {/if}
      {#if !onFile}
        <div class="overlay">
          {#if tabs.active.kind === 'diff' && tabs.active.diff}
            <DiffView diff={tabs.active.diff} />
          {:else}
            <HeatmapView />
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="empty">Nessun file aperto</div>
  {/if}
</div>

<style>
  .area {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .strip {
    display: flex;
    align-items: center;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex: none;
  }
  .tab {
    display: flex;
    align-items: center;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
  }
  .tab.active {
    background: var(--bg);
    color: var(--text);
    box-shadow: inset 0 -2px var(--accent);
  }
  .label {
    padding: 6px 4px 6px 12px;
    white-space: nowrap;
  }
  .orph {
    color: var(--danger);
  }
  .dot {
    color: var(--accent);
  }
  .x {
    padding: 2px 8px;
    color: var(--text-dim);
  }
  .x:hover {
    color: var(--text);
  }
  .err {
    flex: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 12px;
    background: var(--panel-2);
    color: var(--danger);
    border-bottom: 1px solid var(--border);
  }
  .banner {
    flex: none;
    padding: 4px 12px;
    background: var(--panel-2);
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }
  .main {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .body {
    position: absolute;
    inset: 0;
  }
  .body.hidden {
    visibility: hidden;
  }
  .overlay {
    position: absolute;
    inset: 0;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .overlay > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-dim);
  }
</style>
