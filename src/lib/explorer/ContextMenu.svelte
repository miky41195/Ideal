<script lang="ts" module>
  export interface MenuItem {
    label: string;
    action: () => void;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let { x, y, items, onclose }: { x: number; y: number; items: MenuItem[]; onclose: () => void } = $props();

  onMount(() => {
    const close = () => onclose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<!-- mousedown inside must not reach the window close handler -->
<ul class="menu" role="menu" style:left="{x}px" style:top="{y}px" onmousedown={(e) => e.stopPropagation()}>
  {#each items as it (it.label)}
    <li role="none">
      <button
        role="menuitem"
        onclick={() => {
          onclose();
          it.action();
        }}>{it.label}</button
      >
    </li>
  {/each}
</ul>

<style>
  .menu {
    position: fixed;
    z-index: 100;
    margin: 0;
    padding: 4px;
    list-style: none;
    min-width: 160px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow-pop);
  }
  button {
    width: 100%;
    text-align: left;
    padding: 5px 10px;
  }
  button:hover {
    background: var(--accent-soft);
  }
</style>
