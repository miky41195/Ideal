<script lang="ts">
  import { ALL_BLOCKS, layoutRects, zoneAt, zoneRect, type BlockId, type Handle, type Rect, type Zone } from './dock-tree';
  import { dock } from './dock.svelte';
  import { workspace as ws } from '../state/workspace.svelte';
  import ClaudeTabs from '../claude/ClaudeTabs.svelte';
  import EditorArea from '../editor/EditorArea.svelte';
  import TerminalBlock from './TerminalBlock.svelte';
  import Explorer from '../explorer/Explorer.svelte';
  import GitPanel from '../git/GitPanel.svelte';
  import HubPanel from '../hub/HubPanel.svelte';
  import SearchPanel from '../search/SearchPanel.svelte';
  import NotesPanel from '../notes/NotesPanel.svelte';
  import ChangesPanel from '../claude/ChangesPanel.svelte';
  import Icon from '../ui/Icon.svelte';
  import { BLOCK_META } from './meta';
  import { claudeUsage } from '../claude/usage.svelte';
  import { contextLevel, formatTokens } from '../claude/tokens';
  import { sendToActiveClaude } from '../claude/send-bridge';
  import { settings } from '../settings/settings.svelte';
  import { showToast } from '../ui/toast.svelte';
  import { terminalTabs as tt } from '../layout/terminal-tabs.svelte';

  let { project }: { project: string } = $props();

  const META = BLOCK_META;

  /** Below this width per tab, only the active tab keeps its label. */
  const TAB_ROOM = 86;
  const GAP = 6;
  const HEAD = 32;
  const EDGE = 16;

  let el: HTMLDivElement;
  let w = $state(0);
  let h = $state(0);

  const L = $derived(layoutRects(dock.tree, { x: 0, y: 0, w, h }, GAP));

  // A hidden block keeps its last box, so terminals are not resized to nothing.
  const lastBox = new Map<BlockId, Rect>();
  const boxes = $derived.by(() => {
    for (const { group, rect } of L.groups) {
      lastBox.set(group.active, { x: rect.x, y: rect.y + HEAD, w: rect.w, h: Math.max(0, rect.h - HEAD) });
    }
    return new Map(lastBox);
  });
  const box = (b: BlockId) => {
    const r = boxes.get(b);
    return r ? `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px` : 'left:0;top:0;width:100%;height:100%';
  };
  const place = (r: Rect) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;

  /** Keeps a clipped strip usable: wheel scrolls it, the active tab stays in view, an edge fade says there is more. */
  function tabStrip(node: HTMLElement, active: BlockId) {
    const cue = () => node.classList.toggle('more', node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    const wheel = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    const reveal = () => {
      node.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      cue();
    };
    const ro = new ResizeObserver(reveal);
    ro.observe(node);
    node.addEventListener('wheel', wheel, { passive: false });
    node.addEventListener('scroll', cue);
    reveal();
    return {
      update(_next: BlockId) {
        queueMicrotask(reveal);
      },
      destroy() {
        ro.disconnect();
        node.removeEventListener('wheel', wheel);
        node.removeEventListener('scroll', cue);
      },
    };
  }

  const level = $derived(contextLevel(claudeUsage.context, settings.value.claude.contextWarn));
  const runCompact = () => void sendToActiveClaude('/compact').catch((e) => showToast(String(e)));

  function usageHint(context: number | null, draft: number): string {
    const n = (v: number) => v.toLocaleString('it-IT');
    const msg = draft ? `circa ${n(draft)} token di messaggio (stima)` : '';
    if (context === null) return `Primo messaggio: ${msg}, più il contesto iniziale di Claude.`;
    const base = `Al prossimo invio Claude rilegge circa ${n(context)} token di conversazione, in gran parte dalla cache`;
    return msg ? `${base}, più ${msg}.` : `${base}.`;
  }

  function pick(b: BlockId) {
    dock.show(b);
    dock.focused = b;
    if (b === 'claude') ws.showClaude();
    else if (b === 'editor') ws.showEditor();
  }

  function focusIn(b: BlockId) {
    dock.focused = b;
    if (b === 'claude' || b === 'editor') ws.mode = b;
  }

  // ---- drag a tab to rearrange ----
  let drag = $state<{ block: BlockId; x: number; y: number; target: string | null; zone: Zone; rect: Rect | null } | null>(null);
  let justDragged = false;

  function hitTest(x: number, y: number): { target: string; zone: Zone; rect: Rect } | null {
    const edges: [boolean, Zone][] = [
      [x < EDGE, 'left'],
      [x > w - EDGE, 'right'],
      [y < EDGE, 'top'],
      [y > h - EDGE, 'bottom'],
    ];
    const edge = edges.find((e) => e[0]);
    if (edge) {
      const z = edge[1];
      const full = { x: 0, y: 0, w, h };
      const q = z === 'left' || z === 'right' ? { ...full, w: w / 4 } : { ...full, h: h / 4 };
      if (z === 'right') q.x = w - q.w;
      if (z === 'bottom') q.y = h - q.h;
      return { target: 'root', zone: z, rect: q };
    }
    const g = L.groups.find(({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (!g) return null;
    const zone = zoneAt(g.rect, x, y);
    return { target: g.group.id, zone, rect: zoneRect(g.rect, zone) };
  }

  function tabDown(e: PointerEvent, block: BlockId) {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const origin = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      const x = ev.clientX - origin.left;
      const y = ev.clientY - origin.top;
      const hit = hitTest(x, y);
      drag = { block, x, y, target: hit?.target ?? null, zone: hit?.zone ?? 'center', rect: hit?.rect ?? null };
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
    };
    const up = () => {
      stop();
      if (!drag) return;
      justDragged = true;
      if (drag.target) {
        dock.move(block, drag.target, drag.zone);
        dock.focused = block;
      }
      drag = null;
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      stop();
      drag = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  }

  function tabClick(b: BlockId) {
    if (justDragged) {
      justDragged = false;
      return;
    }
    pick(b);
  }

  // ---- resize between blocks ----
  let resizing = $state<'row' | 'col' | null>(null);

  function handleDown(e: PointerEvent, hd: Handle) {
    const start = hd.dir === 'row' ? e.clientX : e.clientY;
    const base = dock.tree;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    resizing = hd.dir;
    const move = (ev: PointerEvent) => {
      const now = hd.dir === 'row' ? ev.clientX : ev.clientY;
      dock.preview(base, hd.path, hd.index, (now - start) / hd.span);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      resizing = null;
      const t = dock.tree;
      dock.tree = base;
      dock.commit(t);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  function handleKey(e: KeyboardEvent, hd: Handle) {
    const back = hd.dir === 'row' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = hd.dir === 'row' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    dock.resize(hd.path, hd.index, e.key === fwd ? 0.02 : -0.02);
  }
</script>

<div class="stage" bind:this={el} bind:clientWidth={w} bind:clientHeight={h}>
  {#each L.groups as { group, rect } (group.id)}
    {@const compact = rect.w < group.blocks.length * TAB_ROOM}
    {@const tight = rect.w < group.blocks.length * 34 + 90}
    <section class="group" class:focused={group.blocks.includes(dock.focused)} style={place(rect)} aria-label={META[group.active].label}>
      <div class="head">
        <div class="tabs" role="tablist" use:tabStrip={group.active}>
        {#each group.blocks as b (b)}
          <button
            class="tab"
            class:on={b === group.active}
            class:moving={drag?.block === b}
            class:slim={compact}
            role="tab"
            aria-selected={b === group.active}
            title="{META[b].label} (trascina per spostare)"
            onpointerdown={(e) => tabDown(e, b)}
            onclick={() => tabClick(b)}
          >
            <Icon name={META[b].icon} size={14} />
            {#if !compact || (b === group.active && !tight)}<span>{META[b].label}</span>{/if}
            {#if b === 'claude' && ws.needsAttention}<i class="dot" title="Claude ti aspetta"></i>{/if}
          </button>
        {/each}
        </div>
        {#if group.active === 'claude'}
          {#if (claudeUsage.context !== null || claudeUsage.draft > 0) && rect.w > 460}
            <span class="usage {level}" title={usageHint(claudeUsage.context, claudeUsage.draft)}>
              {#if claudeUsage.context !== null}{formatTokens(claudeUsage.context)} contesto{/if}{#if claudeUsage.draft}<b>+ ~{formatTokens(claudeUsage.draft)}</b>{/if}
            </span>
            {#if level !== 'ok'}
              <button class="act text" title="Scrive /compact nella casella di Claude: premi Invio per confermare" onclick={runCompact}>Compatta</button>
            {/if}
          {/if}
          <button class="act text" title="costa più token; claude-mem dà già il contesto" onclick={() => ws.addClaudeTab('continue')}>Riprendi ultima</button>
          <button class="act" title="Nuova sessione (Ctrl+Maiusc+T)" aria-label="Nuova sessione" onclick={() => ws.addClaudeTab('new')}><Icon name="plus" size={14} /></button>
        {:else if group.active === 'terminal'}
          <button class="act" title="Nuovo terminale" aria-label="Nuovo terminale" onclick={() => tt.add()}><Icon name="plus" size={14} /></button>
        {/if}
        {#if !group.blocks.includes('claude') && !group.blocks.includes('editor')}
          <button class="act" title="Nascondi blocco" aria-label="Nascondi blocco" onclick={() => dock.collapse(group.id)}><Icon name="minus" size={14} /></button>
        {/if}
      </div>
    </section>
  {/each}

  <!-- Every block lives here, flat: moving one only changes its box, so sessions and undo survive. -->
  {#each ALL_BLOCKS as b (b)}
    {@const shown = dock.visible(b)}
    <div class="body" class:off={!shown} data-block={b} style={box(b)} onfocusin={() => focusIn(b)} onpointerdowncapture={() => focusIn(b)} role="presentation">
      {#if b === 'claude'}
        <ClaudeTabs {ws} cwd={project} visible={shown} />
      {:else if b === 'editor'}
        <EditorArea visible={shown} projectRoot={project} />
      {:else if b === 'terminal'}
        <TerminalBlock cwd={project} visible={shown} />
      {:else if shown}
        <div class="side">
          {#if b === 'explorer'}
            <Explorer root={project} />
          {:else if b === 'git'}
            <GitPanel />
          {:else if b === 'changes'}
            <ChangesPanel projectPath={project} />
          {:else if b === 'search'}
            <SearchPanel projectPath={project} />
          {:else if b === 'notes'}
            <NotesPanel projectPath={project} />
          {:else if b === 'hub'}
            <HubPanel projectPath={project} />
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#each L.handles as hd (hd.path.join('.') + ':' + hd.index)}
    <!-- A focusable separator is an interactive widget in ARIA; Svelte's check does not know that. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="handle {hd.dir}"
      style={place(hd.rect)}
      role="separator"
      tabindex="0"
      aria-orientation={hd.dir === 'row' ? 'vertical' : 'horizontal'}
      aria-label="Ridimensiona blocchi"
      aria-valuenow={0}
      onpointerdown={(e) => handleDown(e, hd)}
      onkeydown={(e) => handleKey(e, hd)}
    ></div>
  {/each}

  {#if drag || resizing}
    <!-- Keeps terminals and editors from swallowing the pointer mid-drag. -->
    <div class="shield" class:row={resizing === 'row'} class:col={resizing === 'col'}></div>
  {/if}
  {#if drag}
    {#if drag.rect}<div class="drop" style={place(drag.rect)}></div>{/if}
    <div class="ghost" style="left:{drag.x + 12}px;top:{drag.y + 12}px">
      <Icon name={META[drag.block].icon} size={14} />{META[drag.block].label}
    </div>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .group {
    position: absolute;
    background: var(--panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow-block);
  }
  .group.focused {
    outline: 1px solid var(--accent-soft);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--head);
    padding: 0 5px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    color: var(--text-dim);
    font-weight: 500;
    flex: none;
    white-space: nowrap;
    touch-action: none;
  }
  .tab.on {
    background: var(--panel-2);
    color: var(--text);
  }
  .focused .tab.on :global(svg) {
    color: var(--accent);
  }
  .tab.slim {
    padding: 0 4px;
  }
  .tab.moving {
    opacity: 0.5;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs:global(.more) {
    mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
  }
  .usage {
    flex: none;
    margin: 0 4px;
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
  }
  .usage.warn {
    color: var(--warn);
  }
  .usage.high {
    color: var(--danger);
    font-weight: 600;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .usage b {
    margin-left: 6px;
    color: var(--accent);
    white-space: nowrap;
    font-weight: 600;
  }
  .act {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    color: var(--text-dim);
  }
  .act.text {
    width: auto;
    padding: 0 8px;
    font-size: 12px;
  }
  .body {
    position: absolute;
    overflow: hidden;
    background: var(--panel);
    border-radius: 0 0 var(--radius) var(--radius);
  }
  .body.off {
    visibility: hidden;
    pointer-events: none;
  }
  .side {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .handle {
    position: absolute;
    z-index: 3;
    background: transparent;
    border-radius: 3px;
    transition: background-color 120ms var(--ease);
  }
  .handle.row {
    cursor: col-resize;
  }
  .handle.col {
    cursor: row-resize;
  }
  .handle:hover,
  .handle:focus-visible {
    background: var(--accent);
  }
  .shield {
    position: absolute;
    inset: 0;
    z-index: 4;
    cursor: grabbing;
  }
  .shield.row {
    cursor: col-resize;
  }
  .shield.col {
    cursor: row-resize;
  }
  .drop {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    background: var(--accent-soft);
    border: 2px solid var(--accent);
    border-radius: var(--radius);
    transition:
      left 120ms var(--ease),
      top 120ms var(--ease),
      width 120ms var(--ease),
      height 120ms var(--ease);
  }
  .ghost {
    position: absolute;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    pointer-events: none;
    background: var(--panel-2);
    color: var(--text);
    font-weight: 500;
    border-radius: var(--radius-s);
    box-shadow: var(--shadow-pop);
  }
</style>
