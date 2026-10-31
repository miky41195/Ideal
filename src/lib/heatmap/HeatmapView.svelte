<script lang="ts">
  import { onMount } from 'svelte';
  import { git, onGitChanged } from '../git/git-store.svelte';
  import { gitHeatmap, gitDayCommits, gitCommitFiles, gitCommitFileDiff, type Heatmap, type CommitInfo, type CommitFile } from '../git/git-client';
  import { tabs } from '../editor/tabs.svelte';
  import { diffTitle } from '../diff/diff-title';
  import { buildGrid, monthLabels, tooltipFor, longDate, localToday } from './calendar';

  let allAuthors = $state(false);
  let data = $state<Heatmap | null>(null);
  let error = $state<string | null>(null);
  let selDate = $state<string | null>(null);
  let commits = $state<CommitInfo[]>([]);
  let selCommit = $state<CommitInfo | null>(null);
  let files = $state<CommitFile[]>([]);
  let seq = 0;
  let daySeq = 0;

  const isRepo = $derived(git.status?.isRepo ?? false);
  const grid = $derived(data ? buildGrid(data.days, localToday()) : []);
  const labels = $derived(monthLabels(grid));
  const total = $derived(data ? data.days.reduce((n, d) => n + d.count, 0) : 0);
  const dayNames = ['lun', '', 'mer', '', 'ven', '', 'dom'];

  async function load() {
    const my = ++seq;
    if (!git.path || !isRepo) {
      data = null;
      error = null;
      return;
    }
    try {
      const d = await gitHeatmap(git.path, allAuthors);
      if (my !== seq) return;
      data = d;
      error = null;
      if (selDate) await loadDay(selDate, true);
    } catch (e) {
      if (my === seq) error = String(e);
    }
  }

  async function loadDay(date: string, keepCommit = false) {
    const my = ++daySeq;
    selDate = date;
    if (!keepCommit) {
      selCommit = null;
      files = [];
    }
    try {
      const list = await gitDayCommits(git.path, date, allAuthors);
      if (my !== daySeq) return;
      commits = list;
      if (selCommit && !commits.some((c) => c.hash === selCommit!.hash)) {
        selCommit = null;
        files = [];
      }
    } catch (e) {
      if (my === daySeq) error = String(e);
    }
  }

  async function pickCommit(c: CommitInfo) {
    selCommit = c;
    files = [];
    try {
      const f = await gitCommitFiles(git.path, c.hash);
      if (selCommit?.hash === c.hash) files = f;
    } catch (e) {
      if (selCommit?.hash === c.hash) error = String(e);
    }
  }

  async function openFile(f: CommitFile) {
    const c = selCommit;
    if (!c) return;
    try {
      const d = await gitCommitFileDiff(git.path, c.hash, f.path, f.oldPath);
      tabs.openDiff(`diff:${c.hash}:${f.path}`, diffTitle(f.path, c.short), { old: d.old, new: d.new, binary: d.binary, langPath: f.path });
    } catch (e) {
      error = String(e);
    }
  }

  $effect(() => {
    void allAuthors;
    void isRepo;
    daySeq++;
    selDate = null;
    selCommit = null;
    commits = [];
    files = [];
    void load();
  });

  onMount(() => onGitChanged(() => void load()));
</script>

<div class="view">
  {#if git.status === null}
    <div class="empty">Caricamento…</div>
  {:else if !isRepo}
    <div class="empty">Non è un repository git</div>
  {:else}
    <header>
      <h2>Attività <span class="total">{total} commit nell'ultimo anno</span></h2>
      <label><input type="checkbox" bind:checked={allAuthors} /> Tutti gli autori</label>
    </header>
    {#if error}<div class="err" role="alert">{error}</div>{/if}
    {#if data && total === 0}
      <div class="empty small">Nessun commit nell'ultimo anno</div>
    {/if}
    {#if data}
      <div class="scroll">
        <div class="cal">
          <div class="months" style="grid-template-columns: repeat({grid.length}, 11px)">
            {#each labels as l (l.col)}<span style="grid-column: {l.col + 1}">{l.label}</span>{/each}
          </div>
          <div class="body">
            <div class="days">{#each dayNames as n}<span>{n}</span>{/each}</div>
            <div class="grid">
              {#each grid as col}
                <div class="col">
                  {#each col as cell}
                    {#if cell}
                      <button
                        class="cell l{cell.level}"
                        class:sel={cell.date === selDate}
                        aria-pressed={cell.date === selDate}
                        title={tooltipFor(cell.date, cell.count)}
                        aria-label={tooltipFor(cell.date, cell.count)}
                        onclick={() => loadDay(cell.date)}
                      ></button>
                    {:else}
                      <span class="cell none"></span>
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
    {#if selDate}
      <div class="panels">
        <section>
          <h3>{longDate(selDate)}</h3>
          {#if commits.length === 0}<div class="dim">Nessun commit</div>{/if}
          <ul>
            {#each commits as c (c.hash)}
              <li>
                <button class="row" class:on={selCommit?.hash === c.hash} onclick={() => pickCommit(c)}>
                  <code>{c.short}</code>
                  <span class="subj">{c.subject}</span>
                  <span class="dim">{c.author}</span>
                  <span class="add">+{c.additions}</span><span class="del">−{c.deletions}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
        {#if selCommit}
          <section>
            <h3>File in {selCommit.short}</h3>
            <ul>
              {#each files as f (f.path)}
                <li>
                  <button class="row" onclick={() => openFile(f)} title={f.path}>
                    <span class="st">{f.status}</span>
                    <span class="subj">{f.path}</span>
                    {#if f.additions === null}<span class="dim">bin</span>{:else}<span class="add">+{f.additions}</span><span class="del">−{f.deletions}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .view { padding: 16px; overflow: auto; color: var(--text); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 16px; }
  h3 { margin: 0 0 6px; font-size: 13px; color: var(--text-dim); font-weight: 600; }
  .total, .dim { color: var(--text-dim); font-size: 12px; font-weight: normal; }
  .total { margin-left: 8px; }
  .empty { display: grid; place-items: center; height: 100%; color: var(--text-dim); }
  .empty.small { height: auto; padding: 8px 0; }
  .err { color: var(--danger); margin-bottom: 8px; }
  .scroll { overflow-x: auto; padding-bottom: 6px; }
  .cal { width: max-content; }
  .months { display: grid; gap: 2px; margin-left: 28px; height: 14px; font-size: 10px; color: var(--text-dim); }
  .months span { white-space: nowrap; }
  .body { display: flex; gap: 4px; }
  .days { display: grid; grid-template-rows: repeat(7, 11px); gap: 2px; width: 24px; font-size: 9px; color: var(--text-dim); line-height: 11px; }
  .grid { display: flex; gap: 2px; }
  .col { display: grid; grid-template-rows: repeat(7, 11px); gap: 2px; }
  .cell { width: 11px; height: 11px; padding: 0; border: 0; border-radius: 2px; background: rgba(107, 79, 216, 0.08); }
  .cell.none { background: transparent; }
  .cell.l1 { background: rgba(107, 79, 216, 0.3); }
  .cell.l2 { background: rgba(107, 79, 216, 0.5); }
  .cell.l3 { background: rgba(107, 79, 216, 0.75); }
  .cell.l4 { background: #6b4fd8; }
  button.cell:hover { outline: 1px solid var(--text-dim); }
  button.cell:focus-visible, button.cell.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
  .panels { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 16px; }
  section { flex: 1 1 320px; min-width: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  .row { display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; padding: 3px 6px; border-radius: 3px; }
  .row:hover, .row.on { background: var(--accent-soft); }
  .subj { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  code { color: var(--accent); }
  .add { color: #3fb950; font-size: 12px; }
  .del { color: var(--danger); font-size: 12px; }
  .st { width: 14px; color: var(--text-dim); }
</style>
