<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import { onTerminalActivity } from '../terminal/activity';
  import { hub } from './hub-store.svelte';
  import { health } from './health.svelte';
  import { relativeDate } from './dates';
  import { observationMarkdown, summaryMarkdown } from './obs-markdown';
  import { openInBrowser, type MdFile } from './hub-client';
  import { readTextFile } from '../fs-client';
  import { tabs } from '../editor/tabs.svelte';
  import { workspace } from '../state/workspace.svelte';
  import { settings } from '../settings/settings.svelte';

  let { projectPath }: { projectPath: string } = $props();
  let open = $state({ sessions: true, mem: true, memories: true, docs: true });
  let q = $state(hub.query);
  let actionError = $state<string | null>(null);
  const starting = $derived(health.mem === 'starting');
  const memDown = $derived(health.mem === 'down' || health.mem === 'starting');
  const memError = $derived(hub.error.observations ?? hub.error.summaries);

  const port = $derived(settings.value.claudeMem.port);
  const isState = (f: MdFile) => /^STATO-PROGETTO/i.test(f.name);
  const docs = $derived([...hub.filteredDocs].sort((a, b) => Number(isState(b)) - Number(isState(a))));

  onMount(() => {
    void hub.refresh();
    const onFocus = () => void hub.refresh();
    window.addEventListener('focus', onFocus);
    // Only while the Hub is mounted: a hidden Hub must not re-read session files on terminal pauses.
    const offActivity = onTerminalActivity(() => hub.refreshOnActivity());
    return () => {
      window.removeEventListener('focus', onFocus);
      offActivity();
      hub.cancelActivity();
    };
  });

  function keyAct(e: KeyboardEvent, fn: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  }
  const shown = () => workspace.showEditor();
  const openSession = (s: { id: string; title: string }) => {
    tabs.openTranscript(projectPath, s);
    shown();
  };
  const openObs = (o: (typeof hub.observations)[number]) => {
    tabs.openDoc(`obs:${o.id}`, o.title, observationMarkdown(o));
    shown();
  };
  const openSummary = (s: (typeof hub.summaries)[number]) => {
    tabs.openDoc(`summary:${s.id}`, s.request ?? 'Riepilogo', summaryMarkdown(s));
    shown();
  };
  async function openFile(f: MdFile) {
    actionError = null;
    try {
      const t = await readTextFile(f.path);
      tabs.openDoc(`md:${f.path}`, f.name, t.content, f.path);
      shown();
    } catch (e) {
      actionError = String(e);
    }
  }
  async function start() {
    actionError = null;
    try {
      await health.ensureWorker();
    } catch (e) {
      actionError = String(e);
    }
  }
  // Worker came up (via any path): load the claude-mem sections.
  $effect(() => {
    if (health.mem === 'up' && hub.memStatus !== 'up') {
      void hub.refresh('observations');
      void hub.refresh('summaries');
    }
  });
  // A call failed because the worker is gone: re-check once per distinct error so health.mem catches up.
  let checkedFor: string | null = null;
  $effect(() => {
    const e = memError;
    if (e && e.includes('claude-mem non attivo') && e !== checkedFor) {
      checkedFor = e;
      void health.check();
    }
  });
  async function browser() {
    actionError = null;
    try {
      await openInBrowser(`http://127.0.0.1:${port}/`, port);
    } catch (e) {
      actionError = String(e);
    }
  }
</script>

<div class="hub">
  <div class="search">
    <input
      type="search"
      placeholder="Cerca in sessioni, memoria, documenti…"
      bind:value={q}
      oninput={() => (hub.query = q)}
      onkeydown={(e) => e.key === 'Enter' && void hub.search(q)}
    />
    {#if hub.searchError}<div class="err" role="alert">{hub.searchError}</div>{/if}
    {#if actionError}<div class="err" role="alert">{actionError}</div>{/if}
  </div>

  <div class="scroll">
    <section>
      <button class="head" aria-expanded={open.sessions} onclick={() => (open.sessions = !open.sessions)}>
        <span class="ttl"><Icon name={open.sessions ? 'chevronDown' : 'chevronRight'} size={12} />Sessioni</span><span class="count">{hub.filteredSessions.length}</span>
      </button>
      {#if open.sessions}
        {#if hub.error.sessions}<div class="err">{hub.error.sessions}</div>{/if}
        {#each hub.filteredSessions as s (s.id)}
          <div class="row" role="button" tabindex="0" title={s.title} onclick={() => openSession(s)} onkeydown={(e) => keyAct(e, () => openSession(s))}>
            <span class="t">{s.title}</span><span class="d">{relativeDate(s.updated)}</span>
          </div>
        {:else}
          {#if !hub.loading.sessions}<div class="dim">Nessuna sessione</div>{/if}
        {/each}
      {/if}
    </section>

    <section>
      <button class="head" aria-expanded={open.mem} onclick={() => (open.mem = !open.mem)}>
        <span class="ttl"><Icon name={open.mem ? 'chevronDown' : 'chevronRight'} size={12} />Memoria claude-mem</span><span class="count">{hub.observations.length}</span>
      </button>
      {#if open.mem}
        {#if memDown}
          <div class="down">
            <div>claude-mem non attivo</div>
            {#if hub.error.observations}<div class="err">{hub.error.observations}</div>{/if}
            {#if hub.error.summaries}<div class="err">{hub.error.summaries}</div>{/if}
            <div class="btns">
              <button onclick={start} disabled={starting}>{starting ? 'Avvio…' : 'Avvia'}</button>
              <button onclick={browser}>Apri nel browser</button>
            </div>
          </div>
        {:else}
          {#if hub.error.observations}<div class="err">{hub.error.observations}</div>{/if}
          {#if hub.error.summaries}<div class="err">{hub.error.summaries}</div>{/if}
          {#each hub.observations as o (o.id)}
            <div class="row" role="button" tabindex="0" title={o.title} onclick={() => openObs(o)} onkeydown={(e) => keyAct(e, () => openObs(o))}>
              <span class="badge">{o.kind}</span><span class="t">{o.title}</span><span class="d">{relativeDate(o.createdAtEpoch)}</span>
            </div>
          {:else}
            {#if !hub.loading.observations}<div class="dim">Nessuna osservazione</div>{/if}
          {/each}
          {#if hub.hasMoreObservations}
            <button class="more" disabled={hub.loading.observations} onclick={() => void hub.loadMoreObservations()}>Altri…</button>
          {/if}
          {#if hub.summaries.length}
            <div class="sub">Riepiloghi</div>
            {#each hub.summaries as s (s.id)}
              <div class="row" role="button" tabindex="0" title={s.request ?? 'Riepilogo'} onclick={() => openSummary(s)} onkeydown={(e) => keyAct(e, () => openSummary(s))}>
                <span class="t">{s.request ?? 'Riepilogo'}</span><span class="d">{relativeDate(s.createdAtEpoch)}</span>
              </div>
            {/each}
          {/if}
        {/if}
      {/if}
    </section>

    <section>
      <button class="head" aria-expanded={open.memories} onclick={() => (open.memories = !open.memories)}>
        <span class="ttl"><Icon name={open.memories ? 'chevronDown' : 'chevronRight'} size={12} />Memorie progetto</span><span class="count">{hub.filteredMemories.length}</span>
      </button>
      {#if open.memories}
        {#if hub.error.memories}<div class="err">{hub.error.memories}</div>{/if}
        {#each hub.filteredMemories as f (f.path)}
          <div class="row" role="button" tabindex="0" title={f.name} onclick={() => openFile(f)} onkeydown={(e) => keyAct(e, () => openFile(f))}>
            <span class="t">{f.name}</span><span class="d">{relativeDate(f.updated)}</span>
          </div>
        {:else}
          {#if !hub.loading.memories}<div class="dim">Nessuna memoria</div>{/if}
        {/each}
      {/if}
    </section>

    <section>
      <button class="head" aria-expanded={open.docs} onclick={() => (open.docs = !open.docs)}>
        <span class="ttl"><Icon name={open.docs ? 'chevronDown' : 'chevronRight'} size={12} />Documenti</span><span class="count">{docs.length}</span>
      </button>
      {#if open.docs}
        {#if hub.error.docs}<div class="err">{hub.error.docs}</div>{/if}
        {#each docs as f (f.path)}
          <div class="row" role="button" tabindex="0" title={f.name} onclick={() => openFile(f)} onkeydown={(e) => keyAct(e, () => openFile(f))}>
            <span class="t">{#if isState(f)}<span class="pin"><Icon name="pin" size={12} /></span>{/if}{f.name}</span><span class="d">{relativeDate(f.updated)}</span>
          </div>
        {:else}
          {#if !hub.loading.docs}<div class="dim">Nessun documento</div>{/if}
        {/each}
      {/if}
    </section>
  </div>
</div>

<style>
  .hub { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .search { padding: 0 8px 6px; }
  .search input { width: 100%; box-sizing: border-box; }
  .scroll { overflow-y: auto; flex: 1; }
  .head { display: flex; justify-content: space-between; width: 100%; padding: 4px 10px; font-size: 12px; font-weight: 600; color: var(--text-dim); }
  .count { opacity: 0.7; }
  .row { margin: 0 4px; border-radius: var(--radius-s); display: flex; align-items: center; gap: 6px; padding: 3px 10px 3px 18px; cursor: pointer; font-size: 12px; }
  .row:hover, .row:focus-visible { background: var(--panel-2); outline: none; }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .d { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
  .badge { font-size: 10px; padding: 0 4px; border: 1px solid var(--border); border-radius: var(--radius-s); color: var(--text-dim); }
  .dim, .sub { padding: 3px 10px 3px 18px; color: var(--text-dim); font-size: 12px; }
  .sub { font-size: 12px; font-weight: 600; padding-top: 8px; }
  .more { margin: 4px 18px; font-size: 12px; }
  .down { padding: 4px 18px; font-size: 12px; color: var(--text-dim); }
  .btns { display: flex; gap: 6px; margin-top: 6px; }
  .ttl { display: flex; align-items: center; gap: 4px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pin { display: inline-block; vertical-align: -2px; margin-right: 4px; color: var(--accent); }
  .err { color: var(--danger); font-size: 11px; padding: 3px 10px; word-break: break-word; }
</style>
