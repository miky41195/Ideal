<script lang="ts">
  import { THEMES, resolveTheme, type Theme } from '../theme/themes';
  import { themeState } from '../theme/theme-state.svelte';
  import { settings } from '../settings/settings.svelte';
  import Icon from '../ui/Icon.svelte';

  let open = $state(false);
  let root: HTMLDivElement;
  const current = $derived(resolveTheme(settings.value.theme));

  function pick(t: Theme) {
    open = false;
    themeState.preview = null;
    void settings.setTheme(t.id);
  }
  // Hovering shows the theme live; leaving puts the saved one back.
  const preview = (t: Theme) => (themeState.preview = t.id);
  const restore = () => (themeState.preview = null);

  function close() {
    open = false;
    restore();
  }

  function outside(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) close();
  }
  function key(e: KeyboardEvent) {
    if (open && e.key === 'Escape') close();
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="wrap" bind:this={root}>
  <button class="btn" title="Tema" aria-label="Tema" aria-expanded={open} onclick={() => (open ? close() : (open = true))}>
    <Icon name="swatch" size={16} />
    <span>{current.label}</span>
  </button>
  {#if open}
    <div class="menu" role="menu" tabindex="-1" onpointerleave={restore}>
      {#each THEMES as t (t.id)}
        <button role="menuitemradio" aria-checked={t.id === current.id} onclick={() => pick(t)} onpointerenter={() => preview(t)} onfocus={() => preview(t)}>
          <span class="sw" style:background={t.canvas}>
            <i style:background={t.panel}></i>
            <i style:background={t.accent}></i>
          </span>
          <span class="name">{t.label}</span>
          <span class="kind">{t.kind === 'dark' ? 'scuro' : 'chiaro'}</span>
          {#if t.id === current.id}<Icon name="check" size={14} />{/if}
        </button>
      {/each}
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
    gap: 10px;
    height: 32px;
    padding: 0 8px;
    text-align: left;
  }
  .sw {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 34px;
    height: 20px;
    padding: 3px;
    border-radius: 5px;
    border: 1px solid var(--border);
  }
  .sw i {
    flex: 1;
    height: 100%;
    border-radius: 2px;
  }
  .name {
    flex: 1;
    font-weight: 500;
  }
  .kind {
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
