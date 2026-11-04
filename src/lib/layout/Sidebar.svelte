<script lang="ts">
  import type { SidebarView } from '../state/workspace.svelte';
  import Explorer from '../explorer/Explorer.svelte';
  import GitPanel from '../git/GitPanel.svelte';
  import HubPanel from '../hub/HubPanel.svelte';
  import SearchPanel from '../search/SearchPanel.svelte';
  import NotesPanel from '../notes/NotesPanel.svelte';
  import VSplitter from './VSplitter.svelte';
  import { settings } from '../settings/settings.svelte';
  let { view, projectPath }: { view: SidebarView; projectPath: string } = $props();
  const titles: Record<SidebarView, string> = {
    explorer: 'Esplora file',
    git: 'Git',
    search: 'Cerca nel progetto',
    notes: 'Note',
    hub: 'Claude Hub',
  };

  // Width survives view switches and restarts (per-viewer convenience, so localStorage is enough).
  const KEY = 'ideal.sidebarWidth';
  function loadWidth(): number {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (v >= 160 && v <= 640) return v;
    } catch {
      /* storage unavailable */
    }
    return settings.value.layout.sidebarWidth;
  }
  let width = $state(loadWidth());
  function resize(w: number) {
    width = w;
    try {
      localStorage.setItem(KEY, String(w));
    } catch {
      /* ignore */
    }
  }
</script>

<aside style:width="{width}px">
  <div class="title">{titles[view]}</div>
  {#if view === 'explorer'}
    <Explorer root={projectPath} />
  {:else if view === 'git'}
    <GitPanel />
  {:else if view === 'search'}
    <SearchPanel {projectPath} />
  {:else if view === 'notes'}
    <NotesPanel {projectPath} />
  {:else if view === 'hub'}
    <HubPanel {projectPath} />
  {:else}
    <div class="body">
      <p class="dim">In arrivo</p>
    </div>
  {/if}
</aside>
<VSplitter {width} onresize={resize} />

<style>
  aside {
    flex: none;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .title {
    padding: 8px 12px;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .body {
    padding: 0 12px;
  }
  .dim {
    color: var(--text-dim);
  }
</style>
