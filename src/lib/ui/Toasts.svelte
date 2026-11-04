<script lang="ts">
  import { toasts } from './toast.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast" role="status">{t.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 40px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--accent-soft);
    border-radius: var(--radius);
    padding: 8px 12px;
    font-size: 12px;
    box-shadow: var(--shadow-pop);
  }
</style>
