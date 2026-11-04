<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import { ask } from '@tauri-apps/plugin-dialog';
  import { listDir, createFile, createDir, renamePath, deletePath } from '../fs-client';
  import { openFile, tabs } from '../editor/tabs.svelte';
  import { workspace } from '../state/workspace.svelte';
  import { toggle, replaceChildren, findNode, type Node } from './tree';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';

  let { root }: { root: string } = $props();

  type Edit = { kind: 'file' | 'dir' | 'rename'; parent: string; target?: string; value: string; error: string };
  type Row = { node: Node; depth: number } | { edit: Edit; depth: number };

  const sep = () => (root.includes('\\') ? '\\' : '/');
  const parentOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
  const join = (dir: string, name: string) => (dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + sep() + name);

  // root is fixed for the window lifetime (project is chosen via URL)
  // svelte-ignore state_referenced_locally
  let tree = $state<Node[]>([{ path: root, name: root, isDir: true }]);
  let selected = $state<string | null>(null);
  let edit = $state<Edit | null>(null);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let status = $state('');

  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (nodes: Node[], depth: number, parent: string) => {
      if (edit && edit.kind !== 'rename' && edit.parent === parent) out.push({ edit, depth });
      for (const n of nodes) {
        if (edit?.kind === 'rename' && edit.target === n.path) out.push({ edit, depth });
        else out.push({ node: n, depth });
        if (n.isDir && n.expanded && n.children) walk(n.children, depth + 1, n.path);
      }
    };
    const r = tree[0];
    walk(r.children ?? [], 0, r.path);
    return out;
  });

  const visibleNodes = $derived(rows.flatMap((r) => ('node' in r ? [r.node] : [])));

  async function refresh(dir: string) {
    try {
      const entries = await listDir(dir);
      tree = replaceChildren(tree, dir, entries);
      status = '';
    } catch (e) {
      status = String(e);
    }
  }

  async function expand(path: string) {
    const n = findNode(tree, path);
    if (n && !n.expanded) tree = await toggle(tree, path, listDir);
  }

  onMount(async () => {
    try {
      tree = await toggle(tree, root, listDir);
    } catch (e) {
      status = String(e);
    }
  });

  async function activate(n: Node) {
    selected = n.path;
    if (n.isDir) {
      try {
        tree = await toggle(tree, n.path, listDir);
      } catch (e) {
        status = String(e);
      }
    } else {
      await openFile(n.path);
      workspace.showEditor();
    }
  }

  async function startNew(kind: 'file' | 'dir', parent: string) {
    try {
      await expand(parent);
    } catch (e) {
      status = String(e);
      return;
    }
    edit = { kind, parent, value: '', error: '' };
  }

  function startRename(n: Node) {
    edit = { kind: 'rename', parent: parentOf(n.path), target: n.path, value: n.name, error: '' };
  }

  async function commit() {
    if (!edit) return;
    const name = edit.value.trim();
    if (!name) {
      edit = null;
      return;
    }
    if (/[\\/]/.test(name)) {
      edit.error = 'il nome non può contenere / o \\';
      return;
    }
    const e = edit;
    try {
      if (e.kind === 'rename') {
        if (name === findNode(tree, e.target!)?.name) {
          edit = null;
          return;
        }
        const to = join(e.parent, name);
        await renamePath(e.target!, to);
        tabs.retarget(e.target!, to);
      } else if (e.kind === 'file') {
        await createFile(join(e.parent, name));
      } else {
        await createDir(join(e.parent, name));
      }
      edit = null;
      await refresh(e.parent);
    } catch (err) {
      if (edit) edit.error = String(err);
    }
  }

  async function remove(n: Node) {
    const ok = await ask(`Spostare ${n.name} nel cestino?`, { title: 'Elimina', kind: 'warning' });
    if (!ok) return;
    try {
      await deletePath(n.path);
      tabs.orphan(n.path);
      if (selected === n.path) selected = null;
      await refresh(parentOf(n.path));
    } catch (err) {
      status = String(err);
    }
  }

  function dirFor(n: Node): string {
    return n.isDir ? n.path : parentOf(n.path);
  }

  function showMenu(ev: MouseEvent, n: Node | null) {
    ev.preventDefault();
    ev.stopPropagation();
    const base = n ? dirFor(n) : root;
    const items: MenuItem[] = [
      { label: 'Nuovo file', action: () => startNew('file', base) },
      { label: 'Nuova cartella', action: () => startNew('dir', base) },
    ];
    if (n) {
      selected = n.path;
      items.push(
        { label: 'Rinomina', action: () => startRename(n) },
        { label: 'Elimina', action: () => remove(n) },
        { label: 'Copia percorso', action: () => void navigator.clipboard.writeText(n.path) },
      );
    }
    menu = { x: ev.clientX, y: ev.clientY, items };
  }

  function onKeydown(ev: KeyboardEvent) {
    if (edit) return;
    const i = visibleNodes.findIndex((n) => n.path === selected);
    const cur = i >= 0 ? visibleNodes[i] : null;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      selected = visibleNodes[Math.min(visibleNodes.length - 1, i + 1)]?.path ?? selected;
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      selected = visibleNodes[Math.max(0, i - 1)]?.path ?? selected;
    } else if (ev.key === 'Enter' && cur) {
      ev.preventDefault();
      void activate(cur);
    } else if (ev.key === 'F2' && cur) {
      ev.preventDefault();
      startRename(cur);
    } else if (ev.key === 'Delete' && cur) {
      ev.preventDefault();
      void remove(cur);
    }
  }

  function focusSelect(el: HTMLInputElement) {
    el.focus();
    const dot = el.value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  }

  function onInputKey(ev: KeyboardEvent) {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      edit = null;
    }
  }
</script>

<div class="explorer">
  <div class="head" oncontextmenu={(e) => showMenu(e, null)} role="presentation">
    <span class="rootname" title={root}>{root.split(/[\\/]/).filter(Boolean).pop() ?? root}</span>
    <button title="Nuovo file" aria-label="Nuovo file" onclick={() => startNew('file', root)}><Icon name="filePlus" size={14} /></button>
    <button title="Nuova cartella" aria-label="Nuova cartella" onclick={() => startNew('dir', root)}><Icon name="folderPlus" size={14} /></button>
    <button title="Aggiorna" aria-label="Aggiorna" onclick={() => refresh(root)}><Icon name="refresh" size={14} /></button>
  </div>
  {#if status}<div class="err">{status}</div>{/if}
  <div class="tree" role="tree" tabindex="0" onkeydown={onKeydown} oncontextmenu={(e) => showMenu(e, null)}>
    {#each rows as r ('node' in r ? r.node.path : 'edit:' + r.edit.kind)}
      {#if 'node' in r}
        <div
          class="row"
          class:sel={selected === r.node.path}
          style:padding-left="{8 + r.depth * 14}px"
          role="treeitem"
          aria-selected={selected === r.node.path}
          aria-expanded={r.node.isDir ? !!r.node.expanded : undefined}
          tabindex="-1"
          onclick={() => activate(r.node)}
          onkeydown={() => {}}
          oncontextmenu={(e) => showMenu(e, r.node)}
        >
          <span class="chev">{#if r.node.isDir}<Icon name={r.node.expanded ? 'chevronDown' : 'chevronRight'} size={12} />{/if}</span>
          <span class="name">{r.node.name}</span>
        </div>
      {:else}
        <div class="row editing" style:padding-left="{8 + r.depth * 14}px">
          <span class="chev"></span>
          <div class="editwrap">
            <input
              use:focusSelect
              bind:value={r.edit.value}
              onkeydown={onInputKey}
              onblur={() => {
                if (edit && !edit.error) edit = null;
              }}
              aria-label={r.edit.kind === 'rename' ? 'Nuovo nome' : r.edit.kind === 'file' ? 'Nome del file' : 'Nome della cartella'}
            />
            {#if r.edit.error}<div class="err">{r.edit.error}</div>{/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>
  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
  {/if}
</div>

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px 4px 12px;
  }
  .rootname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .head button {
    padding: 0 6px;
    color: var(--text-dim);
  }
  .tree {
    flex: 1;
    overflow: auto;
    outline: none;
  }
  .row { margin: 0 4px; border-radius: var(--radius-s);
    display: flex;
    align-items: center;
    height: 22px;
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.sel {
    background: var(--accent-soft);
  }
  .tree:focus-visible .row.sel {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .chev {
    width: 14px;
    flex: none;
    color: var(--text-dim);
    font-size: 12px;
  }
  .editing {
    height: auto;
    min-height: 22px;
    cursor: default;
  }
  .editwrap {
    flex: 1;
    padding-right: 6px;
  }
  input {
    width: 100%;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: var(--radius-s);
    padding: 1px 4px;
    outline: none;
  }
  .err {
    color: var(--danger);
    font-size: 12px;
    padding: 2px 12px;
  }
  .editwrap .err {
    padding: 2px 0;
  }
</style>
