<script lang="ts">
  import { tabs, type EditorTab } from './tabs.svelte';

  let { tab }: { tab: EditorTab } = $props();
</script>

<div class="disk" role="alert">
  <span>Modificato su disco</span>
  <button onclick={() => tabs.reloadFromDisk(tab.path)}>Ricarica</button>
  <button onclick={() => tabs.keepMine(tab.path)}>Tieni il mio</button>
  <button onclick={() => tab.diskConflict !== undefined && tabs.openCompare(tab.path, tab.diskConflict, tab.content)}>Confronta</button>
</div>

<style>
  .disk {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: var(--panel-2);
    color: var(--text);
    border-bottom: 1px solid var(--border);
  }
  .disk span {
    flex: 1;
    color: var(--danger);
  }
  button {
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    color: var(--text);
  }
  button:hover {
    background: var(--accent-soft);
  }
</style>
