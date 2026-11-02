<script lang="ts">
  import type { Mode } from '../state/workspace.svelte';
  import { git } from '../git/git-store.svelte';
  import { workspace } from '../state/workspace.svelte';
  import { health } from '../hub/health.svelte';
  let { mode, path }: { mode: Mode; path: string } = $props();
</script>

<footer>
  <span>{mode === 'claude' ? '✦ Claude' : '✎ Editor'}</span>
  <span class="path" title={path}>{path}</span>
  {#if git.status?.isRepo && git.status.branch}
    <button class="branch" title="Apri Git" onclick={() => (workspace.sidebarView = 'git')}>
      ⎇ {git.status.branch}{#if git.status.upstream}{#if git.status.ahead} ↑{git.status.ahead}{/if}{#if git.status.behind} ↓{git.status.behind}{/if}{/if}
    </button>
  {/if}
  <button
    class="mem {health.mem}"
    disabled={health.mem === 'starting' || health.mem === 'up'}
    title={health.mem === 'up' ? 'claude-mem attivo' : health.mem === 'starting' ? 'avvio…' : 'claude-mem spento — clic per avviare'}
    onclick={() => void health.ensureWorker()}
  >
    <span class="dot">●</span>
    {health.mem === 'up' ? 'claude-mem attivo' : health.mem === 'starting' ? 'avvio…' : health.mem === 'down' ? 'claude-mem spento — clic per avviare' : ''}
  </button>
</footer>

<style>
  footer {
    display: flex;
    gap: 16px;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
  }
  .branch {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .branch:hover {
    text-decoration: underline;
  }
  .mem {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    padding: 0;
    cursor: pointer;
  }
  .mem:disabled {
    cursor: default;
  }
  .mem.unknown {
    display: none;
  }
  .mem.up .dot {
    color: #4ade80;
  }
  .mem.down .dot {
    color: #f87171;
  }
  .mem.starting .dot {
    color: #fbbf24;
  }
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
