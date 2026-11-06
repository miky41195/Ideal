<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../ui/Icon.svelte';
  import { listDir, readTextFile } from '../fs-client';
  import { dock } from '../dock/dock.svelte';
  import { terminalTabs } from '../layout/terminal-tabs.svelte';
  import { packageManager, parseScripts, runLine, type PackageManager, type Script } from './scripts';

  let { projectPath }: { projectPath: string } = $props();

  let scripts = $state<Script[]>([]);
  let pm = $state<PackageManager>('npm');
  let message = $state<string | null>(null);

  async function load() {
    try {
      const [file, entries] = await Promise.all([readTextFile(`${projectPath}/package.json`), listDir(projectPath)]);
      const list = parseScripts(file.content);
      scripts = list ?? [];
      pm = packageManager(file.content, entries.map((e) => e.name));
      message = list === null ? 'package.json non è leggibile' : list.length ? null : 'package.json non ha script';
    } catch {
      scripts = [];
      message = 'Nessun package.json in questa cartella';
    }
  }

  function run(s: Script) {
    dock.show('terminal');
    terminalTabs.add(runLine(pm, s.name));
  }

  onMount(() => void load());
</script>

<div class="panel">
  <div class="bar">
    <span>Script di {pm}</span>
    <button class="ic" title="Rileggi package.json" aria-label="Rileggi package.json" onclick={() => void load()}><Icon name="refresh" size={13} /></button>
  </div>
  {#if message}
    <p class="msg">{message}</p>
  {/if}
  <ul>
    {#each scripts as s (s.name)}
      <li>
        <button title="Esegui in una nuova tab del terminale" onclick={() => run(s)}>
          <Icon name="play" size={13} />
          <span class="name">{s.name}</span>
          <span class="cmd">{s.command}</span>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    padding: 4px 10px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    color: var(--text-dim);
  }
  .msg {
    margin: 8px 10px;
    color: var(--text-dim);
  }
  ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 4px 4px;
    overflow: auto;
    list-style: none;
  }
  li button {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 8px;
    align-items: center;
    width: 100%;
    padding: 4px 6px;
    text-align: left;
    border-radius: var(--radius-s);
  }
  .name {
    overflow: hidden;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cmd {
    grid-column: 2;
    overflow: hidden;
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
