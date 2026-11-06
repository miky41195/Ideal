<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ask } from '@tauri-apps/plugin-dialog';
  import { onCommand } from '../commands';
  import { tabs } from '../editor/tabs.svelte';
  import { workspace as ws } from '../state/workspace.svelte';
  import { projectSearch } from './search-client';
  import { readTextFile, writeTextFile } from '../fs-client';
  import { showToast } from '../ui/toast.svelte';
  import { replaceMatches } from './replace';
  import { groupMatches, createLatest, locateInLine, type Match } from './group';

  let { projectPath }: { projectPath: string } = $props();

  let query = $state('');
  let caseSensitive = $state(false);
  let regex = $state(false);
  let wholeWord = $state(false);
  let matches = $state<Match[]>([]);
  let truncated = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let searched = $state(false);
  let replacement = $state('');
  let replacing = $state(false);
  let input: HTMLInputElement | undefined = $state();
  const latest = createLatest();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const groups = $derived(groupMatches(matches));

  async function run() {
    clearTimeout(timer);
    const tok = latest.next();
    if (!query.trim()) {
      matches = [];
      truncated = false;
      error = null;
      busy = false;
      searched = false;
      return;
    }
    busy = true;
    try {
      const r = await projectSearch(projectPath, query, { regex, caseSensitive, wholeWord });
      if (!latest.isCurrent(tok) || r.superseded) return;
      matches = r.matches;
      truncated = r.truncated;
      error = null;
      searched = true;
    } catch (e) {
      if (!latest.isCurrent(tok)) return;
      matches = [];
      truncated = false;
      error = String(e);
      searched = true;
    } finally {
      if (latest.isCurrent(tok)) busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 300);
  }

  function toggle(which: 'case' | 'regex' | 'word') {
    if (which === 'case') caseSensitive = !caseSensitive;
    else if (which === 'regex') regex = !regex;
    else wholeWord = !wholeWord;
    void run();
  }

  const abs = (rel: string) => `${projectPath.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}`;

  const sameFile = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.toLowerCase();

  /** An open file changes in its buffer and waits for a save; the others are written now. */
  async function replaceInFile(path: string, items: Match[]) {
    const open = tabs.tabs.find((t) => (t.kind ?? 'file') === 'file' && sameFile(t.path, path));
    if (open) {
      if (open.readonly) return { done: 0, skipped: items.length, unsaved: false };
      const r = replaceMatches(open.content, items, replacement);
      if (r.done) tabs.setContent(open.path, r.text);
      return { ...r, unsaved: r.done > 0 };
    }
    const file = await readTextFile(path);
    if (file.readonly) return { done: 0, skipped: items.length, unsaved: false };
    const r = replaceMatches(file.content, items, replacement);
    if (r.done) await writeTextFile(path, r.text, file.eol);
    return { ...r, unsaved: false };
  }

  async function replaceAll() {
    const count = `${matches.length} risultati in ${groups.length} file`;
    const limit = truncated ? ' La ricerca è troncata: gli altri resteranno da sostituire.' : '';
    const ok = await ask(`Sostituire ${count} con "${replacement}"? I file non aperti vengono scritti subito.${limit}`, { title: 'Ideal', kind: 'warning' });
    if (!ok) return;
    replacing = true;
    let done = 0;
    let skipped = 0;
    let unsaved = 0;
    const failed: string[] = [];
    for (const g of groups) {
      try {
        const r = await replaceInFile(abs(g.path), g.items);
        done += r.done;
        skipped += r.skipped;
        if (r.unsaved) unsaved++;
      } catch {
        skipped += g.items.length;
        failed.push(g.path);
      }
    }
    replacing = false;
    const notes = [`${done} sostituiti`];
    if (skipped) notes.push(`${skipped} saltati`);
    if (unsaved) notes.push(`${unsaved} file aperti da salvare`);
    if (failed.length) notes.push(`errore su ${failed.join(', ')}`);
    showToast(notes.join(' · '));
    void run();
  }

  async function go(m: Match) {
    const path = abs(m.path);
    await tabs.openFile(path);
    const tab = tabs.tabs.find((t) => t.path === path);
    const lineText = tab?.content.split('\n')[m.line - 1] ?? '';
    await tabs.reveal(path, m.line, locateInLine(lineText, m), m.len);
    ws.showEditor();
  }

  async function focusInput() {
    const hint = tabs.selectionHint;
    if (hint) query = hint;
    await tick();
    input?.focus();
    input?.select();
    if (hint) void run();
  }

  onMount(() => {
    void focusInput();
    const off = onCommand('searchProject', () => void focusInput());
    return () => {
      off();
      clearTimeout(timer);
      latest.next(); // drop any in-flight response
    };
  });
</script>

<div class="panel">
  <div class="bar">
    <input
      bind:this={input}
      bind:value={query}
      placeholder="Cerca nel progetto…"
      spellcheck="false"
      oninput={schedule}
      onkeydown={(e) => e.key === 'Enter' && run()}
    />
    <button class="tg" class:on={caseSensitive} title="Maiuscole" aria-pressed={caseSensitive} onclick={() => toggle('case')}>Aa</button>
    <button class="tg" class:on={regex} title="Espressione regolare" aria-pressed={regex} onclick={() => toggle('regex')}>.*</button>
    <button class="tg" class:on={wholeWord} title="Parola intera" aria-pressed={wholeWord} onclick={() => toggle('word')}>ab</button>
  </div>
  {#if matches.length}
    <div class="bar">
      <input bind:value={replacement} placeholder="Sostituisci con…" aria-label="Sostituisci con" spellcheck="false" />
      <button class="tg go" disabled={replacing} title="Sostituisci tutti i risultati" onclick={() => void replaceAll()}>Sostituisci</button>
    </div>
  {/if}
  {#if error}
    <div class="msg err">{error}</div>
  {:else if searched}
    <div class="msg">
      {matches.length} risultati in {groups.length} file{truncated ? ' (troncati)' : ''}
    </div>
  {:else if busy}
    <div class="msg">Ricerca…</div>
  {/if}
  <div class="results">
    {#each groups as g (g.path)}
      <div class="file" title={g.path}>{g.path} <span class="n">{g.items.length}</span></div>
      {#each g.items as m, i (g.path + ':' + m.line + ':' + i)}
        <button class="row" onclick={() => go(m)}><span class="ln">{m.line}</span><span class="tx">{m.text.trim()}</span></button>
      {/each}
    {/each}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .bar {
    display: flex;
    gap: 2px;
    padding: 0 8px 6px;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    font-size: 12px;
  }
  .tg {
    padding: 2px 5px;
    font-size: 12px;
    color: var(--text-dim);
    border-radius: var(--radius-s);
  }
  .tg.on {
    color: var(--text);
    background: var(--accent-soft);
  }
  .go {
    width: auto;
    padding: 0 8px;
  }
  .msg {
    padding: 2px 12px 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .msg.err {
    color: var(--danger);
  }
  .results {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .file {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n {
    color: var(--text-dim);
    font-size: 12px;
  }
  .row { margin: 0 4px; border-radius: var(--radius-s);
    display: flex;
    gap: 8px;
    width: calc(100% - 8px);
    text-align: left;
    padding: 2px 12px 2px 20px;
    font-size: 12px;
    color: var(--text-dim);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .row:hover,
  .row:focus-visible {
    background: var(--panel-2);
    color: var(--text);
  }
  .ln {
    min-width: 28px;
    text-align: right;
    opacity: 0.7;
  }
  .tx {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
