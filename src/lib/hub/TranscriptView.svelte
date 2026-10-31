<script lang="ts">
  import { sessionRead, type TranscriptEntry } from './hub-client';
  import { renderMarkdown } from '../markdown/render';
  import { workspace } from '../state/workspace.svelte';

  let { projectPath, sessionId }: { projectPath: string; sessionId: string } = $props();

  const LIMIT = 100;
  let entries = $state<TranscriptEntry[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function more() {
    if (loading) return;
    loading = true;
    try {
      const page = await sessionRead(projectPath, sessionId, entries.length, LIMIT);
      entries = [...entries, ...page.entries];
      total = page.total;
      error = null;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void projectPath;
    void sessionId;
    entries = [];
    total = 0;
    void more();
  });

  function resume() {
    workspace.addClaudeTab('resume', sessionId);
    workspace.showClaude();
  }

  function onclick(e: MouseEvent) {
    if ((e.target as HTMLElement | null)?.closest('a')) e.preventDefault();
  }
</script>

<div class="tr">
  <div class="bar">
    <button class="resume" title="costa più token; claude-mem dà già il contesto" onclick={resume}>Riprendi questa sessione</button>
    <span class="count">{entries.length}/{total}</span>
  </div>
  <div class="list">
    {#each entries as e, i (i)}
      {#if e.kind === 'tool'}
        <div class="tool">⚙ {e.tool ?? 'tool'}</div>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="bubble {e.kind === 'user' ? 'user' : 'assistant'}" {onclick}>{@html renderMarkdown(e.text)}</div>
      {/if}
    {/each}
    {#if error}<div class="err" role="alert">{error}</div>{/if}
    {#if entries.length < total}
      <button class="more" disabled={loading} onclick={more}>{loading ? 'Caricamento…' : 'Carica altri'}</button>
    {/if}
  </div>
</div>

<style>
  .tr {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .bar {
    flex: none;
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 6px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .resume {
    color: var(--accent);
  }
  .count {
    color: var(--text-dim);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    user-select: text;
  }
  .bubble {
    max-width: 80%;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--panel-2);
    line-height: 1.5;
  }
  .bubble.user {
    align-self: flex-end;
    border: 1px solid var(--accent);
  }
  .bubble :global(pre) {
    overflow-x: auto;
  }
  .tool {
    color: var(--text-dim);
    font-size: 0.9em;
  }
  .err {
    color: var(--danger);
  }
  .more {
    align-self: center;
    color: var(--accent);
    padding: 4px 12px;
  }
</style>
