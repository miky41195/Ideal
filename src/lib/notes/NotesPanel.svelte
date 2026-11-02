<script lang="ts">
  import { onMount } from 'svelte';
  import { parseNotes, toggle, addItem, removeItem, editItem, type NoteItem } from './notes-model';
  import { loadNotes, saveNotes, isIdealIgnored, ignoreIdeal } from './notes-client';
  import { sendToActiveClaude } from '../claude/send-bridge';
  import { onTerminalActivity, debounce } from '../terminal/activity';

  let { projectPath }: { projectPath: string } = $props();

  let md = $state('');
  let ignored = $state(true); // hide the button until we know
  let draft = $state('');
  let editing = $state<number | null>(null);
  let editText = $state('');
  let error = $state<string | null>(null);
  let busy = false;

  const items = $derived<NoteItem[]>(parseNotes(md));

  async function reload() {
    // Never clobber an inline edit or a write in flight.
    if (editing !== null || busy) return;
    md = (await loadNotes(projectPath)).md;
  }

  async function checkIgnored() {
    ignored = await isIdealIgnored(projectPath).catch(() => true);
  }

  // Read fresh, transform, write: keeps external edits that happened since the last reload.
  async function mutate(fn: (md: string) => string) {
    busy = true;
    error = null;
    try {
      const cur = await loadNotes(projectPath);
      const next = fn(cur.md);
      if (next !== cur.md) await saveNotes(projectPath, next, cur.eol);
      md = next;
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function add() {
    const t = draft.trim();
    if (!t) return;
    draft = '';
    await mutate((m) => addItem(m, t));
  }

  function startEdit(it: NoteItem) {
    editing = it.line;
    editText = it.text;
  }

  async function commitEdit() {
    if (editing === null) return;
    const line = editing;
    const t = editText;
    editing = null;
    await mutate((m) => editItem(m, line, t));
  }

  async function send(it: NoteItem) {
    error = null;
    try {
      await sendToActiveClaude(it.text);
    } catch (e) {
      error = String(e);
    }
  }

  async function exclude() {
    error = null;
    try {
      await ignoreIdeal(projectPath);
      await checkIgnored();
    } catch (e) {
      error = String(e);
    }
  }

  onMount(() => {
    void reload();
    void checkIgnored();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    const onActivity = debounce(() => void reload(), 1500);
    const off = onTerminalActivity(onActivity);
    return () => {
      window.removeEventListener('focus', onFocus);
      off();
      onActivity.cancel();
    };
  });
</script>

<div class="notes">
  <div class="add">
    <input
      type="text"
      placeholder="Nuova nota…"
      aria-label="Nuova nota"
      bind:value={draft}
      onkeydown={(e) => e.key === 'Enter' && add()}
    />
  </div>

  <div class="scroll">
    {#each items as it (it.line)}
      <div class="row" class:done={it.done}>
        <input
          type="checkbox"
          checked={it.done}
          aria-label="Completata: {it.text}"
          onchange={() => mutate((m) => toggle(m, it.line))}
        />
        {#if editing === it.line}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="edit"
            type="text"
            aria-label="Modifica nota"
            autofocus
            bind:value={editText}
            onblur={commitEdit}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') editing = null;
            }}
          />
        {:else}
          <span
            class="t"
            role="button"
            tabindex="0"
            title="Doppio clic (o F2) per modificare"
            ondblclick={() => startEdit(it)}
            onkeydown={(e) => e.key === 'F2' && startEdit(it)}>{it.text}</span
          >
          <button class="ic" title="Invia a Claude" aria-label="Invia a Claude: {it.text}" onclick={() => send(it)}>➤</button>
          <button class="ic" title="Elimina" aria-label="Elimina: {it.text}" onclick={() => mutate((m) => removeItem(m, it.line))}>✕</button>
        {/if}
      </div>
    {:else}
      <p class="dim">Nessuna nota</p>
    {/each}
  </div>

  {#if error}<p class="err">{error}</p>{/if}
  {#if !ignored}
    <div class="foot">
      <button onclick={exclude} title="Aggiunge .ideal/ a .gitignore">Escludi da git</button>
    </div>
  {/if}
</div>

<style>
  .notes { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .add { padding: 0 8px 6px; }
  .add input { width: 100%; box-sizing: border-box; }
  .scroll { overflow-y: auto; flex: 1; }
  .row { display: flex; align-items: center; gap: 6px; padding: 3px 10px; font-size: 12px; }
  .row:hover, .row:focus-within { background: var(--accent-soft); }
  .row.done .t { text-decoration: line-through; color: var(--text-dim); }
  .t { flex: 1; min-width: 0; overflow-wrap: anywhere; cursor: text; }
  .t:focus-visible { outline: 1px solid var(--accent); }
  .edit { flex: 1; min-width: 0; }
  .ic { padding: 0 5px; color: var(--text-dim); }
  .ic:hover, .ic:focus-visible { color: var(--text); }
  .dim { padding: 3px 10px; color: var(--text-dim); font-size: 12px; }
  .err { color: var(--danger, #e5534b); font-size: 11px; padding: 3px 10px; word-break: break-word; }
  .foot { padding: 6px 10px; border-top: 1px solid var(--border); }
  .foot button { font-size: 12px; }
</style>
