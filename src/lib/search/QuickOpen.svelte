<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { onCommand } from '../commands';
  import { openFile } from '../editor/tabs.svelte';
  import { workspace as ws } from '../state/workspace.svelte';
  import { projectFiles } from './search-client';
  import { rankPaths } from './fuzzy';

  let { projectPath }: { projectPath: string } = $props();

  let open = $state(false);
  let query = $state('');
  let files = $state<string[]>([]);
  let truncated = $state(false);
  let error = $state<string | null>(null);
  let sel = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let prevFocus: HTMLElement | null = null;
  let loadId = 0;

  const results = $derived(rankPaths(query, files));
  $effect(() => {
    void results;
    sel = 0;
  });

  onMount(() =>
    onCommand('quickOpen', async () => {
      prevFocus = document.activeElement as HTMLElement | null;
      query = '';
      error = null;
      open = true;
      const id = ++loadId;
      projectFiles(projectPath)
        .then((r) => {
          if (id !== loadId) return;
          files = r.files;
          truncated = r.truncated;
        })
        .catch((e) => {
          if (id === loadId) error = String(e);
        });
      await tick();
      input?.focus();
    }),
  );

  function close(restore = true) {
    open = false;
    loadId++;
    if (restore) prevFocus?.focus?.();
    prevFocus = null;
  }

  async function choose(rel: string | undefined) {
    if (!rel) return;
    close(false);
    await openFile(`${projectPath.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}`);
    ws.showEditor();
  }

  function onkey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      sel = Math.min(sel + 1, results.length - 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      void choose(results[sel]);
    }
  }

  $effect(() => {
    void sel;
    if (open) document.querySelector('.qo-item.active')?.scrollIntoView({ block: 'nearest' });
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => close()}>
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="box" onclick={(e) => e.stopPropagation()}>
      <input bind:this={input} bind:value={query} onkeydown={onkey} placeholder="Apri file…" spellcheck="false" />
      <div class="list">
        {#each results as r, i (r)}
          <button class="qo-item" class:active={i === sel} onclick={() => choose(r)} onmousemove={() => (sel = i)}>{r}</button>
        {:else}
          <div class="empty">{error ?? 'Nessun file'}</div>
        {/each}
      </div>
      {#if truncated}<div class="note">Troppi file: elenco troncato</div>{/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 15vh;
  }
  .box {
    width: min(560px, 90vw);
    background: var(--panel-2);
    border: 1px solid var(--accent-soft);
    border-radius: 8px;
    padding: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    margin-bottom: 4px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 13px;
    outline: none;
  }
  .list {
    max-height: 50vh;
    overflow-y: auto;
  }
  .qo-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--text);
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .qo-item.active {
    background: var(--accent-soft);
  }
  .empty,
  .note {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
