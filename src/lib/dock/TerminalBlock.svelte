<script lang="ts">
  import { onMount } from 'svelte';
  import TerminalView from '../terminal/TerminalView.svelte';
  import { writePty } from '../terminal/pty-client';
  import { toPtyText } from '../claude/send-bridge';
  import { settings } from '../settings/settings.svelte';
  import { registerCommands } from '../palette/registry';
  import { terminalTabs as tt, type TerminalTab } from '../layout/terminal-tabs.svelte';
  import Icon from '../ui/Icon.svelte';
  import { dock } from './dock.svelte';
  let { cwd, visible }: { cwd: string; visible: boolean } = $props();

  const ENTER = String.fromCharCode(13);
  const START_MS = 2500;
  const QUIET_MS = 700;

  // A shell can drop keys sent before its prompt: a tab's command waits for the screen to settle.
  const waiting = new Map<number, { ptyId: number; timer: ReturnType<typeof setTimeout> }>();

  function send(tabId: number) {
    const w = waiting.get(tabId);
    waiting.delete(tabId);
    const run = tt.tabs.find((t) => t.id === tabId)?.run;
    if (w && run) writePty(w.ptyId, toPtyText(run) + ENTER).catch((e) => console.warn('pty_write failed', e));
  }

  function spawned(tab: TerminalTab, ptyId: number) {
    if (tab.run) waiting.set(tab.id, { ptyId, timer: setTimeout(() => send(tab.id), START_MS) });
  }

  function screenChanged(tabId: number) {
    const w = waiting.get(tabId);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => send(tabId), QUIET_MS);
  }

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
        <TerminalView kind={{ type: 'Shell', program: settings.value.terminal.shell }} {cwd} visible={visible && t.id === tt.active} onspawn={(id) => spawned(t, id)} onscreen={t.run ? () => screenChanged(t.id) : undefined} />
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
