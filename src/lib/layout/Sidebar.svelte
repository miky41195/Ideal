<script lang="ts">
  import type { SidebarView } from '../state/workspace.svelte';
  let { view }: { view: SidebarView } = $props();
  const titles: Record<SidebarView, string> = {
    explorer: 'Esplora file',
    git: 'Git',
    heatmap: 'Heatmap',
    notes: 'Note',
    hub: 'Hub',
  };
</script>

<aside>
  <div class="title">{titles[view]}</div>
  <div class="body">
    <p class="dim">In arrivo</p>
  </div>
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
