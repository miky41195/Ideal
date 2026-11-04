<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { onCommand } from '../commands';
  import { listCommands, filterCommands, type PaletteCommand } from './registry';
  import { showToast } from '../ui/toast.svelte';

  let open = $state(false);
  let query = $state('');
  let items = $state<PaletteCommand[]>([]);
  let sel = $state(0);
  let prevFocus: HTMLElement | null = null;
  let input: HTMLInputElement | undefined = $state();

  const shown = $derived(filterCommands(query, items));
  $effect(() => {
    void shown;
    sel = 0;
  });

  onMount(() =>
    onCommand('palette', async () => {
      prevFocus = document.activeElement as HTMLElement | null;
      query = '';
      items = listCommands();
      open = true;
      await tick();
      input?.focus();
    }),
  );

  function close(restore = true) {
    open = false;
    if (restore) prevFocus?.focus?.();
    prevFocus = null;
  }

  async function run(c: PaletteCommand | undefined) {
    if (!c) return;
    close(false); // the command decides where focus goes
    try {
      await c.run();
    } catch (e) {
      showToast(`${c.label}: ${e}`);
    }
  }

  function onkey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      sel = Math.min(sel + 1, shown.length - 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      void run(shown[sel]);
    }
  }

  $effect(() => {
    void sel;
    if (open) document.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => close()}>
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="box" onclick={(e) => e.stopPropagation()}>
      <input bind:this={input} bind:value={query} onkeydown={onkey} placeholder="Digita un comando…" spellcheck="false" />
      <div class="list">
        {#each shown as c, i (c.id)}
          <button class="pal-item item" class:active={i === sel} onclick={() => run(c)} onmousemove={() => (sel = i)}>
            <span>{c.label}</span>{#if c.keys}<span class="keys">{c.keys}</span>{/if}
          </button>
        {:else}
          <div class="empty">Nessun comando</div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 15vh;
  }
  .box {
    width: min(480px, 90vw);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px;
    box-shadow: var(--shadow-pop);
    outline: none;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 8px;
    margin-bottom: 4px;
    background: transparent;
    color: var(--text);
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    font-size: 14px;
    outline: none;
  }
  .list {
    max-height: 50vh;
    overflow-y: auto;
  }
  .keys {
    float: right;
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .empty {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--text);
    padding: 4px 8px;
    border-radius: var(--radius-s);
    font-size: 13px;
    cursor: pointer;
  }
  .item.active {
    background: var(--accent-soft);
  }
</style>
