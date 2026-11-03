<script lang="ts">
  import { onMount } from 'svelte';
  import TerminalView from '../terminal/TerminalView.svelte';
  import { settings } from '../settings/settings.svelte';
  import { registerCommands } from '../palette/registry';
  import { workspace } from '../state/workspace.svelte';
  import { terminalTabs as tt } from './terminal-tabs.svelte';
  import Splitter from './Splitter.svelte';
  let { cwd, open }: { cwd: string; open: boolean } = $props();
  let height = $state(settings.value.layout.panelHeight);

  onMount(() =>
    registerCommands([
      {
        id: 'newTerminal',
        label: 'Nuovo terminale',
        run: () => {
          workspace.panelOpen = true;
          tt.add();
        },
      },
    ]),
  );
</script>

<!-- Kept mounted when closed so the shells survive toggling; closing a tab unmounts it (kills its PTY). -->
<section class:closed={!open}>
  <Splitter {height} onresize={(h) => (height = h)} />
  <div class="strip" role="tablist">
    {#each tt.tabs as t (t.id)}
      <div class="tab" class:active={t.id === tt.active} role="presentation">
        <button class="label" role="tab" aria-selected={t.id === tt.active} onclick={() => tt.select(t.id)}>{t.title}</button>
        <button class="x" aria-label={`Chiudi ${t.title}`} onclick={() => tt.close(t.id)}>✕</button>
      </div>
    {/each}
    <button class="add" title="Nuovo terminale" aria-label="Nuovo terminale" onclick={() => tt.add()}>+</button>
  </div>
  <div class="body" style:height="{height}px">
    {#each tt.tabs as t (t.id)}
      <div class="pane" class:hidden={t.id !== tt.active}>
        <TerminalView kind={{ type: 'Shell', program: settings.value.terminal.shell }} {cwd} visible={open && t.id === tt.active} />
      </div>
    {/each}
  </div>
</section>

<style>
  section {
    flex: none;
    background: var(--bg);
  }
  section.closed {
    display: none;
  }
  .strip {
    display: flex;
    align-items: center;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
  }
  .tab.active {
    background: var(--bg);
    color: var(--text);
    box-shadow: inset 0 -2px var(--accent);
  }
  .label {
    padding: 3px 4px 3px 12px;
    white-space: nowrap;
  }
  .x,
  .add {
    padding: 2px 8px;
    color: var(--text-dim);
  }
  .x:hover,
  .add:hover {
    color: var(--text);
  }
  .body {
    position: relative;
  }
  .pane {
    position: absolute;
    inset: 0;
  }
  .pane.hidden {
    visibility: hidden;
  }
</style>
