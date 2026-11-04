<script lang="ts">
  import { onMount } from 'svelte';
  import { workspace as ws } from '../state/workspace.svelte';
  import { git } from '../git/git-store.svelte';
  import { gitFileDiff } from '../git/git-client';
  import { tabs } from '../editor/tabs.svelte';
  import { debounce, onTerminalActivity } from '../terminal/activity';
  import { showToast } from '../ui/toast.svelte';
  import { relativeTo, sessionFiles, type SessionFile } from './session-files';

  let { projectPath }: { projectPath: string } = $props();

  let files = $state<SessionFile[]>([]);
  let loaded = $state(false);
  let seq = 0;

  async function load() {
    const my = ++seq;
    try {
      const list = await sessionFiles(projectPath, ws.activeClaudeTab?.sessionId ?? null);
      if (my !== seq) return;
      files = list;
      loaded = true;
    } catch (e) {
      console.warn('session_files failed', e);
    }
  }

  onMount(() => {
    const later = debounce(() => void load(), 1500);
    const off = onTerminalActivity(later);
    return () => {
      off();
      later.cancel();
    };
  });
  $effect(() => {
    void ws.activeClaudeId;
    void load();
  });

  const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const rel = (p: string) => relativeTo(git.path, p);
  const dirOf = (p: string) => {
    const r = rel(p) ?? p;
    return r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '';
  };
  const pending = (p: string) => git.status?.files.find((f) => f.path === rel(p));

  // A file with uncommitted changes opens as a diff; one already committed just opens.
  async function open(f: SessionFile) {
    const change = pending(f.path);
    try {
      if (change) {
        const d = await gitFileDiff(git.path, change.path, false, null);
        tabs.openDiff(`diff:session:${change.path}`, `${nameOf(f.path)} (sessione)`, { old: d.old, new: d.new, binary: d.binary, langPath: change.path });
      } else {
        await tabs.openFile(f.path);
      }
      ws.showEditor();
    } catch (e) {
      showToast(`Impossibile aprire ${nameOf(f.path)}: ${e}`);
    }
  }
</script>

<div class="panel">
  {#if files.length}
    <div class="sum">{files.length === 1 ? '1 file' : `${files.length} file`} in questa sessione</div>
    <div class="list">
      {#each files as f (f.path)}
        <button class="row" title={f.path} onclick={() => open(f)}>
          <span class="state" class:on={pending(f.path)}></span>
          <span class="name">{nameOf(f.path)}</span>
          <span class="dir">{dirOf(f.path)}</span>
          <span class="n">{f.edits}</span>
        </button>
      {/each}
    </div>
  {:else if loaded}
    <p class="empty">Claude non ha ancora modificato file in questa sessione.</p>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .sum {
    padding: 6px 12px 2px;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 600;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: calc(100% - 8px);
    margin: 0 4px;
    padding: 2px 8px;
    text-align: left;
  }
  .state {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1px solid var(--text-dim);
  }
  .state.on {
    background: var(--warn);
    border-color: var(--warn);
  }
  .name {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: 12px;
  }
  .n {
    flex: none;
    color: var(--text-dim);
    font-size: 12px;
  }
  .empty {
    margin: 0;
    padding: 12px;
    color: var(--text-dim);
  }
</style>
