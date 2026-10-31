<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let recent = $state<string[]>([]);
  let error = $state('');

  onMount(() => {
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
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === 'string') await openProject(dir);
  }
</script>

<main>
  <h1>Ideal</h1>
  <button class="primary" onclick={pick}>Apri cartella</button>
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
    max-width: 560px;
    margin: 0 auto;
    padding: 64px 24px;
  }
  h1 {
    margin: 0 0 24px;
    font-weight: 600;
  }
  h2 {
    margin: 32px 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .primary {
    padding: 8px 18px;
    background: var(--accent);
    color: #fff;
  }
  .err {
    color: var(--danger);
  }
</style>
