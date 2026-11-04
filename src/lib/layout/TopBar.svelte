<script lang="ts">
  import { dispatch } from '../commands';
  import { git } from '../git/git-store.svelte';
  import { dock } from '../dock/dock.svelte';
  import { tabs } from '../editor/tabs.svelte';
  import { workspace } from '../state/workspace.svelte';
  import { formatBinding } from '../palette/registry';
  import Icon from '../ui/Icon.svelte';
  import BlockMenu from './BlockMenu.svelte';
  import ThemeMenu from './ThemeMenu.svelte';
  let { name, path }: { name: string; path: string } = $props();

  function heatmap() {
    tabs.openHeatmap();
    workspace.showEditor();
  }
</script>

<header>
  <div class="left">
    <span class="proj" title={path}>{name}</span>
    {#if git.status?.isRepo && git.status.branch}
      <button class="branch" title="Apri Git" onclick={() => dock.show('git')}>
        <Icon name="branch" size={13} /><span class="bn">{git.status.branch}</span>
        {#if git.status.upstream}
          {#if git.status.ahead}<span class="n"><Icon name="up" size={12} />{git.status.ahead}</span>{/if}
          {#if git.status.behind}<span class="n"><Icon name="down" size={12} />{git.status.behind}</span>{/if}
        {/if}
      </button>
    {/if}
  </div>
  <button class="cmd" onclick={() => dispatch('palette')}>
    <Icon name="search" size={14} />
    <span class="ph">Comandi e file</span>
    <kbd>{formatBinding('palette')}</kbd>
  </button>
  <div class="right">
    <button class="tool" title="Heatmap dei commit" aria-label="Heatmap dei commit" onclick={heatmap}><Icon name="calendar" size={16} /></button>
    <BlockMenu />
    <ThemeMenu />
  </div>
</header>

<style>
  header {
    display: grid;
    grid-template-columns: 1fr minmax(220px, 420px) 1fr;
    align-items: center;
    gap: 12px;
    flex: none;
    height: 38px;
    padding: 0 10px;
    color: var(--canvas-text);
  }
  .left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }
  .proj {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .bn {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .branch {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    color: var(--canvas-dim);
    font-size: 12px;
  }
  .branch:hover:not(:disabled),
  .tool:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--canvas-text);
  }
  .n {
    display: flex;
    align-items: center;
  }
  .cmd {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 8px;
    background: var(--panel);
    color: var(--text-dim);
    border-color: var(--border);
  }
  .cmd:hover:not(:disabled) {
    background: var(--panel-2);
    color: var(--text);
  }
  .ph {
    flex: 1;
    text-align: left;
  }
  kbd {
    font: inherit;
    font-size: 12px;
  }
  @media (max-width: 1000px) {
    header {
      grid-template-columns: minmax(0, 1fr) minmax(160px, 300px) auto;
    }
  }
  .right {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 28px;
    height: 26px;
    color: var(--canvas-dim);
  }
</style>
