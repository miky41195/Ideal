<script lang="ts">
  import { onMount } from 'svelte';
  import { ask } from '@tauri-apps/plugin-dialog';
  import { onCommand } from '../commands';
  import { tabs, dirty, isFileTab } from './tabs.svelte';
  import DiffView from '../diff/DiffView.svelte';
  import HeatmapView from '../heatmap/HeatmapView.svelte';
  import DocView from '../hub/DocView.svelte';
  import TranscriptView from '../hub/TranscriptView.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import DiskBanner from './DiskBanner.svelte';
  import Icon from '../ui/Icon.svelte';

  let { visible = true, projectRoot = '' }: { visible?: boolean; projectRoot?: string } = $props();

  const hasHeatmap = $derived(tabs.tabs.some((t) => t.kind === 'heatmap'));

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
          {t.name}{#if t.orphaned}<span class="orph"> (eliminato)</span>{/if}{#if dirty(t)}<span class="dot" aria-label="modificato"></span>{/if}
        </button>
        <button class="x" aria-label={`Chiudi ${t.name}`} onclick={() => close(t.path)}><Icon name="close" size={12} /></button>
      </div>
    {/each}
  </div>
  {#if tabs.errorMessage}
    <div class="err" role="alert">
      <span>{tabs.errorMessage}</span>
      <button class="x" aria-label="Chiudi messaggio" onclick={() => tabs.dismissError()}><Icon name="close" size={12} /></button>
    </div>
  {/if}
  {#if tabs.active}
    {@const onFile = tabs.active === tabs.activeFileTab}
    {#if onFile && tabs.active.readonly}
      <div class="banner">Sola lettura: {tabs.active.reason ?? 'non modificabile'}</div>
    {/if}
    {#if onFile && tabs.active.diskConflict !== undefined}
      <DiskBanner tab={tabs.active} />
    {/if}
    <div class="main">
      {#if tabs.activeFileTab}
        <div class="body" class:hidden={!onFile}>
          <CodeEditor tab={tabs.activeFileTab} {projectRoot} visible={visible && onFile} isOpen={(p) => tabs.tabs.some((t) => t.path === p && isFileTab(t))} onchange={(p, c) => tabs.setContent(p, c)} />
        </div>
      {/if}
      {#if hasHeatmap}
        <!-- Stays mounted while the tab exists, so the selection survives opening a diff. -->
        <div class="overlay" class:hidden={tabs.active.kind !== 'heatmap'}>
          <HeatmapView />
        </div>
      {/if}
      {#if tabs.active.kind === 'doc' && tabs.active.doc}
        <div class="overlay">
          <DocView markdown={tabs.active.doc.markdown} />
        </div>
      {/if}
      {#if tabs.active.kind === 'transcript' && tabs.active.transcript}
        <div class="overlay">
          {#key tabs.active.path}
            <TranscriptView projectPath={tabs.active.transcript.projectPath} sessionId={tabs.active.transcript.sessionId} />
          {/key}
        </div>
      {/if}
      {#if tabs.active.kind === 'diff' && tabs.active.diff}
        <div class="overlay">
          <DiffView diff={tabs.active.diff} />
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
    gap: 2px;
    height: 28px;
    padding: 0 6px;
    background: var(--panel);
    overflow-x: auto;
    flex: none;
  }
  .strip:empty {
    display: none;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: var(--radius-s);
    color: var(--text-dim);
  }
  .tab.active {
    background: var(--panel-2);
    color: var(--text);
  }
  .label {
    padding: 1px 2px 1px 8px;
    white-space: nowrap;
  }
  .label:hover:not(:disabled) {
    background: none;
  }
  .orph {
    color: var(--danger);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    color: var(--text-dim);
  }
  .x:hover:not(:disabled) {
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
  .overlay.hidden {
    visibility: hidden;
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
