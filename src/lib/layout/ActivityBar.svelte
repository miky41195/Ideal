<script lang="ts">
  import { tabs } from '../editor/tabs.svelte';
  import { workspace } from '../state/workspace.svelte';
  import type { SidebarView } from '../state/workspace.svelte';
  let { active, onselect }: { active: SidebarView | null; onselect: (v: SidebarView) => void } = $props();
  const items: { id: SidebarView | 'heatmap'; icon: string; label: string }[] = [
    { id: 'explorer', icon: '🗂', label: 'Esplora file' },
    { id: 'git', icon: '⎇', label: 'Git' },
    { id: 'heatmap', icon: '▦', label: 'Heatmap' },
    { id: 'notes', icon: '✎', label: 'Note' },
    { id: 'hub', icon: '◈', label: 'Hub' },
  ];

  function pick(id: SidebarView | 'heatmap') {
    if (id === 'heatmap') {
      tabs.openHeatmap();
      workspace.showEditor();
    } else onselect(id);
  }
</script>

<nav>
  {#each items as it (it.id)}
    <button class:on={it.id === 'heatmap' ? tabs.activePath === 'heatmap:' && workspace.mode === 'editor' : active === it.id} title={it.label} aria-label={it.label} onclick={() => pick(it.id)}>
      {it.icon}
    </button>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 42px;
    padding: 6px 4px;
    background: var(--panel);
    border-right: 1px solid var(--border);
  }
  button {
    height: 34px;
    font-size: 16px;
    color: var(--text-dim);
  }
  button.on {
    color: var(--text);
    border-left: 2px solid var(--accent);
    border-radius: 0;
    background: var(--accent-soft);
  }
</style>
