<script lang="ts">
  import { onMount } from 'svelte';
  import TerminalView from '../terminal/TerminalView.svelte';
  import { settings } from '../settings/settings.svelte';
  import { registerCommands } from '../palette/registry';
  import { terminalTabs as tt } from '../layout/terminal-tabs.svelte';
  import Icon from '../ui/Icon.svelte';
  import { dock } from './dock.svelte';
  let { cwd, visible }: { cwd: string; visible: boolean } = $props();

  onMount(() =>
    registerCommands([
      {
        id: 'newTerminal',
        label: 'Nuovo terminale',
        run: () => {
          dock.show('terminal');
          tt.add();
        },
      },
    ]),
  );
</script>

<!-- Stays mounted when hidden so the shells survive; closing a tab unmounts it (kills its PTY). -->
<div class="block">
  {#if tt.tabs.length > 1}
  <div class="strip" role="tablist">
    {#each tt.tabs as t (t.id)}
      <div class="tab" class:on={t.id === tt.active} role="presentation">
        <button class="label" role="tab" aria-selected={t.id === tt.active} onclick={() => tt.select(t.id)}>{t.title}</button>
        <button class="x" aria-label={`Chiudi ${t.title}`} onclick={() => tt.close(t.id)}><Icon name="close" size={12} /></button>
      </div>
    {/each}
  </div>
  {/if}
  <div class="body">
    {#each tt.tabs as t (t.id)}
      <div class="pane" class:off={t.id !== tt.active}>
        <TerminalView kind={{ type: 'Shell', program: settings.value.terminal.shell }} {cwd} visible={visible && t.id === tt.active} />
      </div>
    {/each}
  </div>
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    height: 28px;
    padding: 0 6px;
    background: var(--panel);
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: var(--radius-s);
    color: var(--text-dim);
  }
  .tab.on {
    background: var(--panel-2);
    color: var(--text);
  }
  .label {
    padding: 1px 2px 1px 8px;
    white-space: nowrap;
  }
  .label:hover:not(:disabled) {
    background: none;
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    color: var(--text-dim);
  }
  .x:hover:not(:disabled) {
    color: var(--text);
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .pane {
    position: absolute;
    inset: 0;
  }
  .pane.off {
    visibility: hidden;
  }
</style>
