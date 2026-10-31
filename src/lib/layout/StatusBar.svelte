<script lang="ts">
  import type { Mode } from '../state/workspace.svelte';
  import { git } from '../git/git-store.svelte';
  import { workspace } from '../state/workspace.svelte';
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
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
