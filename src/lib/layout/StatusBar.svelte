<script lang="ts">
  import type { Mode } from '../state/workspace.svelte';
  let { mode, path }: { mode: Mode; path: string } = $props();
</script>

<footer>
  <span>{mode === 'claude' ? '✦ Claude' : '✎ Editor'}</span>
  <span class="path" title={path}>{path}</span>
  <span class="branch"></span>
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
  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
