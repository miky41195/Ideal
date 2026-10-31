<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { onCommand } from '../commands';
  import { settingsPath } from '../settings/settings.svelte';
  import { openFile } from '../editor/tabs.svelte';
  import { workspace as ws } from '../state/workspace.svelte';
  import { showToast } from '../ui/toast.svelte';

  let open = $state(false);
  let box: HTMLDivElement | undefined = $state();

  onMount(() =>
    onCommand('palette', async () => {
      open = true;
      await tick();
      box?.focus();
    }),
  );

  async function openSettings() {
    open = false;
    try {
      await openFile(await settingsPath());
      ws.showEditor();
    } catch (e) {
      showToast(`Impossibile aprire settings.json: ${e}`);
    }
  }

  function onkey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      open = false;
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      void openSettings();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (open = false)}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="box" tabindex="0" bind:this={box} onkeydown={onkey} onclick={(e) => e.stopPropagation()}>
      <button class="item active" onclick={openSettings}>Apri settings.json</button>
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
    background: var(--panel-2);
    border: 1px solid var(--accent-soft);
    border-radius: 8px;
    padding: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    outline: none;
  }
  .item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--text);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }
  .item.active {
    background: var(--accent-soft);
  }
</style>
