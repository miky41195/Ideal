<script lang="ts">
  import { dock } from '../dock/dock.svelte';
  import { ALL_BLOCKS, type BlockId } from '../dock/dock-tree';
  import { BLOCK_META } from '../dock/meta';
  import Icon from '../ui/Icon.svelte';

  let open = $state(false);
  let root: HTMLDivElement;

  function pick(b: BlockId) {
    if (dock.canHide(b)) dock.toggle(b);
    else dock.show(b);
    open = false;
  }
  function reset() {
    dock.reset();
    open = false;
  }
  function outside(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }
  function key(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="wrap" bind:this={root}>
  <button class="btn" title="Blocchi" aria-label="Blocchi" aria-expanded={open} onclick={() => (open = !open)}>
    <Icon name="blocks" size={16} />
    <span>Blocchi</span>
  </button>
  {#if open}
    <div class="menu" role="menu">
      {#each ALL_BLOCKS as b (b)}
        <button role="menuitemcheckbox" aria-checked={dock.visible(b)} disabled={dock.visible(b) && !dock.canHide(b)} onclick={() => pick(b)}>
          <Icon name={BLOCK_META[b].icon} size={14} />
          <span class="name">{BLOCK_META[b].label}</span>
          {#if dock.visible(b)}<Icon name="check" size={14} />{/if}
        </button>
      {/each}
      <hr />
      <button role="menuitem" onclick={reset}>
        <Icon name="undo" size={14} />
        <span class="name">Ripristina disposizione</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    color: var(--canvas-dim);
  }
  .btn:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--canvas-text);
  }
  .menu {
    position: absolute;
    top: 30px;
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 220px;
    padding: 4px;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    text-align: left;
  }
  .name {
    flex: 1;
  }
  hr {
    width: 100%;
    margin: 3px 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
</style>
