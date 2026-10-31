<script lang="ts">
  import type { SidebarView } from '../state/workspace.svelte';
  import Explorer from '../explorer/Explorer.svelte';
  import GitPanel from '../git/GitPanel.svelte';
  import HubPanel from '../hub/HubPanel.svelte';
  let { view, projectPath }: { view: SidebarView; projectPath: string } = $props();
  const titles: Record<SidebarView, string> = {
    explorer: 'Esplora file',
    git: 'Git',
    notes: 'Note',
    hub: 'Claude Hub',
  };
</script>

<aside>
  <div class="title">{titles[view]}</div>
  {#if view === 'explorer'}
    <Explorer root={projectPath} />
  {:else if view === 'git'}
    <GitPanel />
  {:else if view === 'hub'}
    <HubPanel {projectPath} />
  {:else}
    <div class="body">
      <p class="dim">In arrivo</p>
    </div>
  {/if}
</aside>

<style>
  aside {
    width: 240px;
    background: var(--panel);
    border-right: 1px solid var(--border);
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
