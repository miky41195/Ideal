<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { getVersion } from '@tauri-apps/api/app';
  import { createDir } from '../fs-client';

  let recent = $state<string[]>([]);
  let error = $state('');
  let version = $state('');
  let naming = $state(false);
  let name = $state('');

  onMount(() => {
    getVersion()
      .then((v) => (version = v))
      .catch(() => {});
    invoke<string[]>('get_recent')
      .then((r) => (recent = r))
      .catch((e) => (error = String(e)));
  });

  async function openProject(path: string) {
    try {
      await invoke('open_project_window', { path });
      await getCurrentWindow().close();
    } catch (e) {
      error = String(e);
    }
  }

  async function pick() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === 'string') await openProject(dir);
    } catch (e) {
      error = String(e);
    }
  }

  async function create() {
    const n = name.trim();
    // Only a single folder name: separators would create nested or outside paths.
    if (!n || /[\\/]/.test(n) || n === '.' || n === '..') {
      error = 'Nome non valido';
      return;
    }
    try {
      const parent = await open({ directory: true, multiple: false, title: 'Dove creare il progetto' });
      if (typeof parent !== 'string') return;
      const path = `${parent.replace(/[\\/]+$/, '')}\\${n}`;
      await createDir(path);
      await openProject(path);
    } catch (e) {
      error = String(e);
    }
  }
</script>

<main>
  <h1>Ideal{#if version}<span class="ver">v{version}</span>{/if}</h1>
  <div class="actions">
    <button class="primary" onclick={pick}>Apri cartella</button>
    <button onclick={() => ((naming = !naming), (error = ''))}>Nuovo progetto</button>
  </div>
  {#if naming}
    <form
      class="new"
      onsubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={name} placeholder="Nome del progetto" aria-label="Nome del progetto" autofocus />
      <button class="primary" type="submit" disabled={!name.trim()}>Crea…</button>
    </form>
  {/if}
  {#if recent.length}
    <h2>Recenti</h2>
    <ul>
      {#each recent as p (p)}
        <li><button onclick={() => openProject(p)} title={p}>{p}</button></li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
</main>

<style>
  main {
    max-width: 520px;
    margin: 0 auto;
    padding: 72px 24px;
  }
  h1 {
    margin: 0 0 20px;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--canvas-text);
  }
  .ver {
    margin-left: 10px;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0;
    color: var(--canvas-dim);
  }
  h2 {
    margin: 32px 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--canvas-dim);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
    background: var(--panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow-block);
  }
  li button {
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .actions,
  .new {
    display: flex;
    gap: 8px;
  }
  .new {
    margin-top: 12px;
  }
  .new input {
    flex: 1;
  }
  .err {
    color: var(--danger);
  }
</style>
