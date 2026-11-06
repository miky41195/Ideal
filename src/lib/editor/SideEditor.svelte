<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from './CodeEditor.svelte';
  import { tabs, isFileTab, remapPath } from './tabs.svelte';

  let { visible = true, projectRoot = '' }: { visible?: boolean; projectRoot?: string } = $props();

  // Starts on the file in front; from then on it follows its own choice, not the main editor.
  let path = $state(tabs.activeFileTab?.path ?? null);
  const files = $derived(tabs.tabs.filter(isFileTab));
  const tab = $derived(files.find((t) => t.path === path) ?? files[0]);

  onMount(() =>
    tabs.onRetarget((from, to) => {
      if (path) path = remapPath(path, from, to) ?? path;
    }),
  );
</script>

<div class="side" role="presentation" onfocusin={() => (tabs.focusPath = tab?.path ?? null)} onfocusout={() => (tabs.focusPath = null)}>
  {#if tab}
    <select aria-label="File mostrato" value={tab.path} onchange={(e) => (path = e.currentTarget.value)}>
      {#each files as f (f.path)}
        <option value={f.path}>{f.name}</option>
      {/each}
    </select>
    <div class="body">
      <CodeEditor {tab} {projectRoot} {visible} primary={false} isOpen={(p) => tabs.tabs.some((t) => t.path === p && isFileTab(t))} onchange={(p, c) => tabs.setContent(p, c)} />
    </div>
  {:else}
    <div class="empty">Apri un file per vederlo anche qui</div>
  {/if}
</div>

<style>
  .side {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  select {
    flex: none;
    height: 26px;
    margin: 2px 6px;
    padding: 0 6px;
    color: var(--text);
    background: var(--panel-2);
    border: 0;
    border-radius: var(--radius-s);
    font: inherit;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .empty {
    display: grid;
    flex: 1;
    place-items: center;
    color: var(--text-dim);
  }
</style>
