<script lang="ts">
  import { health } from '../hub/health.svelte';
  import { pluginEnable } from '../hub/hub-client';
  import Icon from '../ui/Icon.svelte';

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
    <button class="x" aria-label="Chiudi" title="Chiudi" onclick={() => (dismissed = true)}><Icon name="close" size={12} /></button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 var(--gap) var(--gap);
    padding: 4px 10px;
    background: var(--panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow-block);
    font-size: 12px;
  }
  .items {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .items button {
    padding: 0 6px;
    color: var(--accent);
    font-weight: 600;
  }
  .note {
    color: var(--text-dim);
  }
  .err {
    color: var(--danger);
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    color: var(--text-dim);
  }
</style>
