<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import TerminalView from '../terminal/TerminalView.svelte';
  import { writePty } from '../terminal/pty-client';
  import { setClaudeSender } from './send-bridge';
  import type { PtyKind } from '../terminal/pty-client';
  import type { ClaudeTab, Workspace } from '../state/workspace.svelte';
  import Icon from '../ui/Icon.svelte';
  import { claudeUsage } from './usage.svelte';
  import { estimateTokens, remoteFromScreen } from './tokens';
  import { debounce, onTerminalActivity } from '../terminal/activity';
  import { AttentionTracker } from './attention';
  import { callBack } from './notify';
  import { settings } from '../settings/settings.svelte';

  let { ws, cwd, visible }: { ws: Workspace; cwd: string; visible: boolean } = $props();

  // Per-tab runtime status and restart generation (restart = remount via {#key}).
  let status = $state<Record<string, { exited?: boolean; error?: string; gen: number }>>({});
  const st = (id: string) => status[id] ?? { gen: 0 };

  function kindOf(t: ClaudeTab): PtyKind {
    if (t.kind === 'continue') return { type: 'Claude', resume: null, continue_last: true };
    if (t.kind === 'resume') return { type: 'Claude', resume: t.resumeId ?? null, continue_last: false };
    return { type: 'Claude', resume: null, continue_last: false, session_id: t.sessionId ?? null };
  }

  // PTY ids per tab (plain maps: not rendered). Waiters resolve once a tab's PTY has spawned.
  const ptys = new Map<string, number>();
  const waiters = new Map<string, { ok: (id: number) => void; fail: (e: Error) => void }[]>();

  function spawned(tabId: string, ptyId: number) {
    ptys.set(tabId, ptyId);
    waiters.get(tabId)?.forEach((w) => w.ok(ptyId));
    waiters.delete(tabId);
  }

  function failWaiters(tabId: string, msg: string) {
    waiters.get(tabId)?.forEach((w) => w.fail(new Error(msg)));
    waiters.delete(tabId);
  }

  function ptyFor(tabId: string): Promise<number> {
    const id = ptys.get(tabId);
    if (id !== undefined) return Promise.resolve(id);
    return new Promise((ok, fail) => waiters.set(tabId, [...(waiters.get(tabId) ?? []), { ok, fail }]));
  }

  // One tracker per tab; a tab being looked at needs no call back.
  const trackers = new Map<string, AttentionTracker>();
  const tracker = (id: string) => trackers.get(id) ?? trackers.set(id, new AttentionTracker()).get(id)!;
  const beingWatched = (id: string) => visible && id === ws.activeClaudeId && document.hasFocus();

  function checkAttention() {
    const now = Date.now();
    for (const t of ws.claudeTabs) {
      if (!tracker(t.id).tick(now) || beingWatched(t.id)) continue;
      t.attention = true;
      if (settings.value.claude.notify) void callBack('Claude ti aspetta', `${t.title} ha finito o chiede una risposta`);
    }
  }

  onMount(() => {
    const timer = setInterval(checkAttention, 1000);
    const seen = () => {
      if (visible) ws.clearAttention(ws.activeClaudeId);
    };
    window.addEventListener('focus', seen);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', seen);
    };
  });
  // Reacts to looking at a tab only: tracking `attention` here would clear every mark the moment it is set.
  $effect(() => {
    const id = ws.activeClaudeId;
    if (visible) untrack(() => ws.clearAttention(id));
  });

  // Real context size comes from the transcript once output settles; nothing runs while hidden.
  const readUsage = () => {
    if (visible) void claudeUsage.refresh(cwd, ws.activeClaudeTab?.sessionId ?? null);
  };
  onMount(() => {
    const later = debounce(readUsage, 1500);
    const off = onTerminalActivity(later);
    return () => {
      off();
      later.cancel();
    };
  });
  $effect(() => {
    void ws.activeClaudeId;
    claudeUsage.context = null;
    claudeUsage.draft = 0;
    claudeUsage.tab = ws.activeClaudeId;
    readUsage();
  });

  // Types text into the active Claude (no Enter), creating a tab first if there is none.
  onMount(() =>
    setClaudeSender(async (text, submit) => {
      const tab = ws.activeClaudeTab ?? ws.addClaudeTab('new');
      ws.showClaude();
      const id = await ptyFor(tab.id);
      await writePty(id, text);
      if (!submit) return;
      // Sent apart: text and Enter in one write would arrive as a paste, and Enter would not submit.
      await new Promise((r) => setTimeout(r, 150));
      await writePty(id, '\r');
    }),
  );

  function close(id: string) {
    ptys.delete(id);
    trackers.delete(id);
    failWaiters(id, 'Sessione Claude chiusa');
    delete status[id];
    ws.closeClaudeTab(id);
  }

  function restart(id: string) {
    ptys.delete(id);
    failWaiters(id, 'Sessione Claude riavviata');
    ws.renewSession(id);
    status[id] = { gen: st(id).gen + 1 };
  }
</script>

<div class="pane">
  {#if ws.claudeTabs.length > 1}
  <div class="strip">
    {#each ws.claudeTabs as t (t.id)}
      <div class="tab" class:on={t.id === ws.activeClaudeId}>
        <button class="label" onclick={() => ws.selectClaudeTab(t.id)}>{t.title}{#if t.attention}<span class="dot" aria-label="ti aspetta"></span>{/if}</button>
        <button class="x" title="Chiudi" aria-label="Chiudi {t.title}" onclick={() => close(t.id)}><Icon name="close" size={12} /></button>
      </div>
    {/each}
  </div>
  {/if}

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
            onsubmit={() => tracker(t.id).onSubmit(Date.now())}
            onscreen={() => tracker(t.id).onOutput(Date.now())}
            ondraft={shown
              ? (text, rows) => {
                  claudeUsage.draft = estimateTokens(text);
                  const said = remoteFromScreen(rows);
                  if (said !== null) claudeUsage.screens[t.id] = said;
                }
              : undefined}
            onexit={() => {
              ptys.delete(t.id);
              failWaiters(t.id, 'Sessione Claude terminata');
              status[t.id] = { ...st(t.id), exited: true };
            }}
            onerror={(m) => {
              failWaiters(t.id, m);
              status[t.id] = { ...st(t.id), error: m };
            }}
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
    height: 28px;
    padding: 0 6px;
    background: var(--panel);
    flex: none;
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
  }
  .label:hover:not(:disabled) {
    background: none;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 6px;
    border-radius: 50%;
    background: var(--accent);
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
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
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
    color: var(--accent-fg);
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    background: var(--accent);
    filter: brightness(1.08);
  }
</style>
