<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { previewUrl } from './preview-url';

  let { block, visible }: { block: string; visible: boolean } = $props();

  const key = () => `ideal.preview.${block}`;
  function saved(): string {
    try {
      return localStorage.getItem(key()) ?? '';
    } catch {
      return '';
    }
  }

  let address = $state(saved());
  let url = $state<string | null>(null);
  let bad = $state(false);
  let reloads = $state(0);

  // Nothing loads until the block is first seen; after that it stays alive while hidden.
  $effect(() => {
    if (visible && url === null && address) url = previewUrl(address);
  });

  function go(e: SubmitEvent) {
    e.preventDefault();
    const next = previewUrl(address);
    bad = next === null;
    if (!next) return;
    address = next;
    if (next === url) reloads++;
    url = next;
    try {
      localStorage.setItem(key(), next);
    } catch {
      /* the address is only a convenience */
    }
  }
</script>

<div class="preview">
  <form onsubmit={go}>
    <input aria-label="Indirizzo" placeholder="Porta o indirizzo, es. 5173" spellcheck="false" bind:value={address} oninput={() => (bad = false)} />
    <button class="act" title="Ricarica" aria-label="Ricarica"><Icon name="refresh" size={14} /></button>
  </form>
  {#if bad}
    <p class="msg" role="alert">Si possono aprire solo indirizzi https o server locali.</p>
  {/if}
  {#if url}
    {#key `${url}#${reloads}`}
      <iframe title="Anteprima" src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" referrerpolicy="no-referrer"></iframe>
    {/key}
  {:else}
    <div class="empty">Scrivi la porta del tuo server locale e premi Invio</div>
  {/if}
</div>

<style>
  .preview {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  form {
    display: flex;
    flex: none;
    gap: 4px;
    padding: 2px 6px 4px;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    color: var(--text);
    background: var(--panel-2);
    border: 0;
    border-radius: var(--radius-s);
    font: inherit;
    user-select: text;
  }
  .act {
    display: grid;
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    color: var(--text-dim);
  }
  .msg {
    margin: 0 8px 4px;
    color: var(--danger);
    font-size: 12px;
  }
  iframe {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: #fff;
  }
  .empty {
    display: grid;
    flex: 1;
    place-items: center;
    padding: 16px;
    color: var(--text-dim);
    text-align: center;
  }
</style>
