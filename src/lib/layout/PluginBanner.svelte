<script lang="ts">
  import { health } from '../hub/health.svelte';
  import { pluginEnable } from '../hub/hub-client';

  const PLUGINS = [
    { field: 'claudeMem', name: 'claude-mem', key: 'claude-mem@thedotmack' },
    { field: 'caveman', name: 'caveman', key: 'caveman@caveman' },
  ] as const;

  let dismissed = $state(false); // per session, in memory only
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const off = $derived(health.plugins ? PLUGINS.filter((p) => !health.plugins![p.field]) : []);

  async function enable(p: (typeof PLUGINS)[number]) {
    busy = p.key;
    error = null;
    try {
      await pluginEnable(p.key);
      await health.check();
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }
</script>

{#if off.length && !dismissed}
  <div class="banner" role="status">
    <div class="items">
      {#each off as p (p.key)}
        <span>
          Plugin {p.name} disattivo —
          <button disabled={busy === p.key} onclick={() => enable(p)}>{busy === p.key ? 'Attivo…' : 'Attiva'}</button>
        </span>
      {/each}
      <span class="note">Effetto dalla prossima sessione Claude</span>
      {#if error}<span class="err">{error}</span>{/if}
    </div>
    <button class="x" aria-label="Chiudi" title="Chiudi" onclick={() => (dismissed = true)}>×</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 10px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border, #333);
    font-size: 12px;
  }
  .items {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .note {
    opacity: 0.7;
  }
  .err {
    color: #f14c4c;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  .x {
    background: none;
    border: 0;
    color: inherit;
    font-size: 16px;
    line-height: 1;
  }
</style>
