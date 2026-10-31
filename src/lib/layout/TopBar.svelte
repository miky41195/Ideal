<script lang="ts">
  import type { Mode } from '../state/workspace.svelte';
  let { name, mode, ontoggle }: { name: string; mode: Mode; ontoggle: () => void } = $props();
</script>

<header>
  <span class="name">{name}</span>
  <div class="seg" role="group" aria-label="Modalità">
    <button class:on={mode === 'claude'} onclick={() => mode !== 'claude' && ontoggle()}>✦ Claude</button>
    <button class:on={mode === 'editor'} onclick={() => mode !== 'editor' && ontoggle()}>✎ Editor</button>
  </div>
  <span class="spacer"></span>
</header>

<style>
  header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 38px;
    padding: 0 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .name {
    color: var(--text-dim);
    font-weight: 600;
  }
  .seg {
    display: flex;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 2px;
    gap: 2px;
  }
  .seg button {
    padding: 3px 14px;
    color: var(--text-dim);
  }
  .seg button.on {
    background: var(--accent);
    color: #fff;
  }
</style>
