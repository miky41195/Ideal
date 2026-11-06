import {
  PRESETS,
  activate,
  addExtra,
  defaultLayout,
  findGroup,
  isVisible,
  keepExtras,
  moveBlock,
  normalize,
  placeTab,
  removeBlock,
  resizeAt,
  setCollapsed,
  type BlockId,
  type DockNode,
  type ExtraKind,
  type Zone,
} from './dock-tree';

// Per-viewer convenience: one arrangement for all projects, like the old sidebar width.
const KEY = 'ideal.dock.v1';
const SAVED_KEY = 'ideal.dock.saved.v1';

export interface SavedLayout {
  name: string;
  tree: DockNode;
}

function loadSaved(): SavedLayout[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    if (Array.isArray(raw)) return raw.filter((l) => typeof l?.name === 'string' && l.tree);
  } catch {
    /* storage unavailable or corrupt */
  }
  return [];
}

function load(): DockNode {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt */
  }
  return defaultLayout();
}

export class DockStore {
  tree = $state.raw<DockNode>(load());
  /** Last block that held keyboard focus, for the highlight and the move commands. */
  focused = $state<BlockId>('claude');
  saved = $state.raw<SavedLayout[]>(loadSaved());

  commit(t: DockNode): void {
    if (t === this.tree) return;
    this.tree = t;
    try {
      localStorage.setItem(KEY, JSON.stringify(t));
    } catch {
      /* ignore */
    }
  }

  visible(b: BlockId): boolean {
    return isVisible(this.tree, b);
  }

  show(b: BlockId): void {
    if (!this.visible(b)) this.commit(activate(this.tree, b));
  }

  /** Rail and shortcut behaviour: reveal, or put away; the group holding Claude or the editor stays. */
  toggle(b: BlockId): void {
    if (!this.visible(b)) return this.show(b);
    const g = findGroup(this.tree, b);
    if (!g || g.blocks.includes('claude') || g.blocks.includes('editor')) return;
    this.commit(setCollapsed(this.tree, g.id, true));
  }

  /** True when hiding this block hides only it, and its group may be put away. */
  canHide(b: BlockId): boolean {
    const g = findGroup(this.tree, b);
    return !!g && g.blocks.length === 1 && b !== 'claude' && b !== 'editor';
  }

  collapse(groupId: string): void {
    this.commit(setCollapsed(this.tree, groupId, true));
  }

  move(b: BlockId, target: string, zone: Zone): void {
    this.commit(moveBlock(this.tree, b, target, zone));
  }

  place(b: BlockId, target: string, slot: number): void {
    this.commit(placeTab(this.tree, b, target, slot));
  }

  /** Live drag: updates the view from a fixed base tree, saved once on release. */
  preview(base: DockNode, path: number[], index: number, delta: number): void {
    this.tree = resizeAt(base, path, index, delta);
  }

  resize(path: number[], index: number, delta: number): void {
    this.commit(resizeAt(this.tree, path, index, delta));
  }

  /** Adds a block of this kind beside the existing one. */
  add(kind: ExtraKind): BlockId {
    const { tree, block } = addExtra(this.tree, kind);
    this.commit(tree);
    this.focused = block;
    return block;
  }

  remove(b: BlockId): void {
    this.commit(removeBlock(this.tree, b));
    if (this.focused === b) this.focused = 'claude';
  }

  reset(): void {
    this.commit(keepExtras(defaultLayout(), this.tree));
  }

  applyPreset(id: string): void {
    const p = PRESETS.find((x) => x.id === id);
    if (p) this.commit(keepExtras(p.build(), this.tree));
  }

  /** Same name replaces. */
  saveLayout(name: string): void {
    const n = name.trim();
    if (!n) return;
    this.#setSaved([...this.saved.filter((l) => l.name !== n), { name: n, tree: this.tree }]);
  }

  applySaved(name: string): void {
    const l = this.saved.find((x) => x.name === name);
    if (l) this.commit(keepExtras(normalize(l.tree), this.tree));
  }

  deleteSaved(name: string): void {
    this.#setSaved(this.saved.filter((l) => l.name !== name));
  }

  #setSaved(list: SavedLayout[]): void {
    this.saved = list;
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
}

export const dock = new DockStore();
