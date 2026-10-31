<script lang="ts">
  import { ask } from '@tauri-apps/plugin-dialog';
  import { git } from './git-store.svelte';
  import {
    gitStage, gitUnstage, gitDiscard, gitCommit, gitBranches, gitSwitch, gitCreateBranch,
    gitFetch, gitPull, gitPush, gitFileDiff, type Branch, type FileChange,
  } from './git-client';
  import { groupFiles, statusLetter } from './groups';
  import { tabs } from '../editor/tabs.svelte';
  import { workspace } from '../state/workspace.svelte';
  import { diffTitle, STAGED_LABEL, UNSTAGED_LABEL } from '../diff/diff-title';

  let message = $state('');
  let branches = $state<Branch[]>([]);
  let branchOpen = $state(false);
  let creating = $state(false);
  let newName = $state('');

  let branchEl = $state<HTMLElement | null>(null);
  function onWindowDown(e: MouseEvent) {
    if (branchOpen && branchEl && !branchEl.contains(e.target as Node)) branchOpen = false;
  }
  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && branchOpen) branchOpen = false;
  }

  const st = $derived(git.status);
  const groups = $derived(groupFiles(st?.files ?? []));
  const canCommit = $derived(message.trim().length > 0 && groups.staged.length > 0 && !git.busy);
  const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const dir = (p: string) => {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i > 0 ? p.slice(0, i) : '';
  };
  const letterClass = (f: FileChange) => {
    const l = statusLetter(f);
    return l === '?' ? 'lq' : 'l' + l;
  };

  const sections = $derived(
    [
      { key: 'conflict', title: 'Conflitti', files: groups.conflict },
      { key: 'staged', title: 'Modifiche in stage', files: groups.staged },
      { key: 'unstaged', title: 'Modifiche', files: groups.unstaged },
      { key: 'untracked', title: 'Non tracciati', files: groups.untracked },
    ].filter((s) => s.files.length > 0),
  );

  async function toggleBranches() {
    branchOpen = !branchOpen;
    creating = false;
    if (branchOpen) {
      try {
        branches = await gitBranches(git.path);
      } catch (e) {
        git.error = String(e);
        branchOpen = false;
      }
    }
  }

  async function pickBranch(name: string) {
    branchOpen = false;
    if (name === st?.branch) return;
    await git.run('switch', () => gitSwitch(git.path, name));
  }

  async function createBranch() {
    const name = newName.trim();
    if (!name) return;
    const ok = await git.run('branch', () => gitCreateBranch(git.path, name));
    if (ok) {
      creating = false;
      branchOpen = false;
      newName = '';
    }
  }

  const stage = (files: FileChange[]) =>
    git.run('stage', () => gitStage(git.path, files.map((f) => f.path)));
  const unstage = (files: FileChange[]) =>
    git.run('unstage', () => gitUnstage(git.path, files.map((f) => f.path)));

  async function discard(f: FileChange) {
    const name = base(f.path);
    const text =
      f.group === 'untracked'
        ? `Spostare ${name} nel cestino?`
        : `Scartare le modifiche a ${name}? Non si può annullare.`;
    if (!(await ask(text, { kind: 'warning' }))) return;
    await git.run('discard', () => gitDiscard(git.path, [f.path]));
  }

  async function commit() {
    if (!canCommit) return;
    const ok = await git.run('commit', () => gitCommit(git.path, message));
    if (ok) message = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      void commit();
    }
  }

  async function openDiff(f: FileChange) {
    const staged = f.group === 'staged';
    try {
      const d = await gitFileDiff(git.path, f.path, staged);
      tabs.openDiff(
        `diff:${staged ? 'staged' : 'unstaged'}:${f.path}`,
        diffTitle(f.path, staged ? STAGED_LABEL : UNSTAGED_LABEL),
        { old: d.old, new: d.new, binary: d.binary, langPath: f.path },
      );
      workspace.showEditor();
    } catch (e) {
      git.error = String(e);
    }
  }

  const remote = (label: string, fn: (p: string) => Promise<void>) =>
    git.run(label, () => fn(git.path));
</script>

<svelte:window onmousedown={onWindowDown} onkeydown={onWindowKey} />

<div class="panel">
  {#if git.error}
    <div class="bar err" role="alert">
      <span>{git.error}</span>
      <button class="icon" title="Chiudi" aria-label="Chiudi errore" onclick={() => (git.error = null)}>×</button>
    </div>
  {/if}

  {#if git.statusError}
    <p class="msg err-inline">{git.statusError}</p>
  {/if}

  {#if !st}
    {#if !git.statusError}<p class="msg">Caricamento…</p>{/if}
  {:else if !st.isRepo}
    <p class="msg">Non è un repository git</p>
  {:else if st}
    <div class="head">
      <div class="branch" bind:this={branchEl}>
        <button class="bbtn" onclick={toggleBranches} title="Cambia branch">
          {st.branch ?? '(detached)'} ▾
        </button>
        {#if branchOpen}
          <div class="drop">
            {#each branches as b (b.name)}
              <button class:cur={b.current} disabled={!!git.busy} onclick={() => pickBranch(b.name)}>{b.name}</button>
            {/each}
            {#if creating}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                autofocus
                placeholder="Nome del branch"
                bind:value={newName}
                onkeydown={(e) => {
                  if (e.key === 'Enter') void createBranch();
                  if (e.key === 'Escape') creating = false;
                }}
              />
            {:else}
              <button disabled={!!git.busy} onclick={() => (creating = true)}>+ Nuovo branch…</button>
            {/if}
          </div>
        {/if}
      </div>
      <div class="remote">
        <button disabled={!!git.busy} onclick={() => remote('fetch', gitFetch)}>Fetch</button>
        <button disabled={!!git.busy} onclick={() => remote('pull', gitPull)}>
          Pull{st.behind ? ` ↓${st.behind}` : ''}
        </button>
        <button disabled={!!git.busy} onclick={() => remote('push', gitPush)}>
          Push{st.ahead ? ` ↑${st.ahead}` : ''}
        </button>
        {#if git.busy}<span class="spin" title={git.busy}></span>{/if}
      </div>
    </div>

    <div class="commit">
      <textarea rows="3" placeholder="Messaggio di commit" bind:value={message} onkeydown={onKey}
      ></textarea>
      <button class="primary" disabled={!canCommit} onclick={commit}>Commit</button>
    </div>

    <div class="list">
      {#each sections as s (s.key)}
        <div class="sec">
          <span>{s.title} ({s.files.length})</span>
          {#if s.key === 'staged'}
            <button class="icon" title="Rimuovi tutto dallo stage" aria-label="Rimuovi tutto dallo stage" disabled={!!git.busy} onclick={() => unstage(s.files)}>−</button>
          {:else if s.key !== 'conflict'}
            <button class="icon" title="Aggiungi tutto allo stage" aria-label="Aggiungi tutto allo stage" disabled={!!git.busy} onclick={() => stage(s.files)}>+</button>
          {/if}
        </div>
        {#each s.files as f (s.key + ':' + f.path)}
          <div
            class="row"
            role="button"
            tabindex="0"
            onclick={() => openDiff(f)}
            onkeydown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                void openDiff(f);
              }
            }}
            title={f.path}
          >
            <span class="let {letterClass(f)}">{statusLetter(f)}</span>
            <span class="name">{base(f.path)}</span>
            <span class="dir">{dir(f.path)}</span>
            <span class="acts">
              {#if s.key === 'staged'}
                <button class="icon" title="Rimuovi dallo stage" aria-label="Rimuovi dallo stage" disabled={!!git.busy} onclick={(e) => { e.stopPropagation(); void unstage([f]); }}>−</button>
              {:else}
                {#if s.key !== 'conflict'}
                  <button class="icon" title="Scarta" aria-label="Scarta modifiche" disabled={!!git.busy} onclick={(e) => { e.stopPropagation(); void discard(f); }}>↺</button>
                {/if}
                <button class="icon" title="Aggiungi allo stage" aria-label="Aggiungi allo stage" disabled={!!git.busy} onclick={(e) => { e.stopPropagation(); void stage([f]); }}>+</button>
              {/if}
            </span>
          </div>
        {/each}
      {/each}
      {#if sections.length === 0}
        <p class="msg">Nessuna modifica</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; flex: 1; min-height: 0; font-size: 12px; }
  .msg { color: var(--text-dim); padding: 6px 12px; margin: 0; }
  .bar { display: flex; gap: 6px; align-items: flex-start; padding: 6px 8px; margin: 0 8px 6px; border-radius: 5px; }
  .err { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); border: 1px solid var(--danger); word-break: break-word; }
  .bar span { flex: 1; }
  .err-inline { color: var(--danger); word-break: break-word; }
  .head { padding: 0 8px 6px; display: flex; flex-direction: column; gap: 6px; }
  .branch { position: relative; }
  .bbtn { width: 100%; text-align: left; background: var(--panel-2); border-color: var(--border); padding: 4px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drop { position: absolute; z-index: 10; left: 0; right: 0; top: 100%; margin-top: 2px; max-height: 220px; overflow: auto; background: var(--panel-2); border: 1px solid var(--border); border-radius: 5px; display: flex; flex-direction: column; }
  .drop button { text-align: left; padding: 4px 8px; border-radius: 0; }
  .drop button:hover { background: var(--accent-soft); }
  .drop .cur { color: var(--accent); }
  .drop input { margin: 4px; padding: 4px 6px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; font: inherit; }
  .remote { display: flex; gap: 4px; align-items: center; }
  .remote button { flex: 1; padding: 3px 4px; border-color: var(--border); }
  .remote button:hover:not(:disabled) { background: var(--accent-soft); }
  button:disabled { opacity: 0.45; cursor: default; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: s 0.8s linear infinite; }
  @keyframes s { to { transform: rotate(360deg); } }
  .commit { padding: 0 8px 6px; display: flex; flex-direction: column; gap: 4px; }
  textarea { resize: vertical; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 5px; padding: 5px 6px; font: inherit; }
  textarea:focus, .drop input:focus { outline: 1px solid var(--accent); }
  .primary { background: var(--accent); padding: 4px; }
  .list { flex: 1; overflow: auto; }
  .sec { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 2px 12px; color: var(--text-dim); text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.05em; }
  .row { display: flex; align-items: center; gap: 6px; padding: 2px 8px 2px 12px; cursor: pointer; }
  .row:hover { background: var(--accent-soft); }
  .name { white-space: nowrap; }
  .dir { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .let { width: 12px; text-align: center; font-weight: 600; }
  .lM { color: #e0b34f; }
  .lA, .lR { color: #5fbf7a; }
  .lD, .lU { color: var(--danger); }
  .lq { color: var(--text-dim); }
  .acts { display: none; gap: 2px; margin-left: auto; }
  .row:hover .acts, .row:focus-within .acts { display: flex; }
  .row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
  .icon { padding: 0 6px; line-height: 18px; }
  .icon:hover { background: var(--panel-2); }
</style>
