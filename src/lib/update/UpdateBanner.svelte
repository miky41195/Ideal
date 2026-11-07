<script lang="ts">
  import { updater } from './update.svelte';

  let showNotes = $state(false);
</script>

{#if updater.available && !updater.later}
  <div class="banner" role="status">
    <span class="msg">
      {#if updater.state === 'working'}
        Aggiorno Ideal {updater.available.version}…{updater.progress !== null ? ` ${updater.progress}%` : ''} Ideal si riaprirà da solo.
      {:else}
        È disponibile Ideal {updater.available.version}.
        <span class="note">Le modifiche non salvate vengono conservate.</span>
      {/if}
    </span>
    {#if updater.error}<span class="err">{updater.error}</span>{/if}
    {#if updater.state !== 'working'}
      {#if updater.available.notes}
        <button aria-expanded={showNotes} onclick={() => (showNotes = !showNotes)}>Novità</button>
      {/if}
      <button class="go" onclick={() => void updater.install()}>{updater.state === 'error' ? 'Riprova' : 'Aggiorna ora'}</button>
      <button onclick={() => (updater.later = true)}>Più tardi</button>
    {/if}
    {#if showNotes}<p class="notes">{updater.available.notes}</p>{/if}
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin: 0 var(--gap) var(--gap);
    padding: 4px 10px;
    background: var(--panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow-block);
    font-size: 12px;
  }
  .msg {
    flex: 1;
    min-width: 0;
  }
  .note {
    color: var(--text-dim);
  }
  .err {
    color: var(--danger);
  }
  .notes {
    flex-basis: 100%;
    margin: 2px 0;
    color: var(--text-dim);
    white-space: pre-wrap;
    user-select: text;
  }
  button {
    padding: 0 6px;
    color: var(--text-dim);
  }
  .go {
    color: var(--accent);
    font-weight: 600;
  }
</style>
