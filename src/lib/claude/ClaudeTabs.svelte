<script lang="ts">
  import { onMount } from 'svelte';
  import TerminalView from '../terminal/TerminalView.svelte';
  import { writePty } from '../terminal/pty-client';
  import { setClaudeSender } from './send-bridge';
  import type { PtyKind } from '../terminal/pty-client';
  import type { ClaudeTab, Workspace } from '../state/workspace.svelte';

  let { ws, cwd, visible }: { ws: Workspace; cwd: string; visible: boolean } = $props();

  // Per-tab runtime status and restart generation (restart = remount via {#key}).
  let status = $state<Record<string, { exited?: boolean; error?: string; gen: number }>>({});
  const st = (id: string) => status[id] ?? { gen: 0 };

  function kindOf(t: ClaudeTab): PtyKind {
    if (t.kind === 'continue') return { type: 'Claude', resume: null, continue_last: true };
    if (t.kind === 'resume') return { type: 'Claude', resume: t.resumeId ?? null, continue_last: false };
    return { type: 'Claude', resume: null, continue_last: false };
  }

  // PTY ids per tab (plain maps: not rendered). Waiters resolve once a tab's PTY has spawned.
  const ptys = new Map<string, number>();
  const waiters = new Map<string, ((id: number) => void)[]>();

  function spawned(tabId: string, ptyId: number) {
    ptys.set(tabId, ptyId);
    waiters.get(tabId)?.forEach((r) => r(ptyId));
    waiters.delete(tabId);
  }

  function ptyFor(tabId: string): Promise<number> {
    const id = ptys.get(tabId);
    if (id !== undefined) return Promise.resolve(id);
    return new Promise((r) => waiters.set(tabId, [...(waiters.get(tabId) ?? []), r]));
  }

  // Types text into the active Claude (no Enter), creating a tab first if there is none.
  onMount(() =>
    setClaudeSender(async (text) => {
      const tab = ws.activeClaudeTab ?? ws.addClaudeTab('new');
      ws.showClaude();
      await writePty(await ptyFor(tab.id), text);
    }),
  );

  function close(id: string) {
    ptys.delete(id);
    waiters.delete(id);
    delete status[id];
    ws.closeClaudeTab(id);
  }

  function restart(id: string) {
    ptys.delete(id);
    status[id] = { gen: st(id).gen + 1 };
  }
</script>

<div class="pane">
  <div class="strip">
    {#each ws.claudeTabs as t (t.id)}
      <div class="tab" class:on={t.id === ws.activeClaudeId}>
        <button class="label" onclick={() => ws.selectClaudeTab(t.id)}>{t.title}</button>
        <button class="x" title="Chiudi" aria-label="Chiudi {t.title}" onclick={() => close(t.id)}>×</button>
      </div>
    {/each}
    <button class="add" title="Nuova sessione (Ctrl+Maiusc+T)" aria-label="Nuova sessione" onclick={() => ws.addClaudeTab('new')}>+</button>
    <button
      class="resume"
      title="costa più token; claude-mem dà già il contesto"
      onclick={() => ws.addClaudeTab('continue')}>Riprendi ultima</button
    >
  </div>

  <div class="stage">
    {#each ws.claudeTabs as t (t.id)}
      {@const s = st(t.id)}
      {@const shown = visible && t.id === ws.activeClaudeId}
      <div class="slot" class:off={!shown}>
        {#key s.gen}
          <TerminalView
            kind={kindOf(t)}
            {cwd}
            visible={shown}
            onspawn={(pid) => spawned(t.id, pid)}
            onexit={() => (status[t.id] = { ...st(t.id), exited: true })}
            onerror={(m) => (status[t.id] = { ...st(t.id), error: m })}
          />
        {/key}
        {#if shown && (s.error || s.exited)}
          <div class="overlay">
            {#if s.error}
              <p>{s.error.includes('claude non trovato') ? 'claude non trovato nel PATH' : s.error}</p>
              <button onclick={() => restart(t.id)}>Riprova</button>
            {:else}
              <p>Sessione terminata</p>
              <button onclick={() => restart(t.id)}>Riavvia</button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
    {#if ws.claudeTabs.length === 0}
      <div class="empty">
        <button class="primary" onclick={() => ws.addClaudeTab('new')}>+ Nuova sessione Claude</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .strip {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 6px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: 5px;
    color: var(--text-dim);
  }
  .tab.on {
    background: var(--accent-soft);
    color: var(--text);
  }
  .tab button {
    padding: 3px 8px;
  }
  .x {
    padding: 3px 6px;
    color: var(--text-dim);
  }
  .add {
    padding: 2px 9px;
    font-size: 15px;
  }
  .resume {
    margin-left: auto;
    padding: 3px 10px;
    color: var(--text-dim);
    border-color: var(--border);
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .slot {
    position: absolute;
    inset: 0;
  }
  .slot.off {
    visibility: hidden;
    pointer-events: none;
  }
  .overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    background: var(--panel-2);
    border-top: 1px solid var(--border);
  }
  .overlay p {
    margin: 0;
    flex: 1;
  }
  .overlay button {
    border-color: var(--accent);
    padding: 3px 12px;
  }
  .empty {
    height: 100%;
    display: grid;
    place-items: center;
  }
  .primary {
    padding: 8px 18px;
    background: var(--accent);
    color: #fff;
  }
</style>
