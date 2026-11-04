import {
  activate,
  defaultLayout,
  findGroup,
  isVisible,
  moveBlock,
  normalize,
  resizeAt,
  setCollapsed,
  type BlockId,
  type DockNode,
  type Zone,
} from './dock-tree';

// Per-viewer convenience: one arrangement for all projects, like the old sidebar width.
const KEY = 'ideal.dock.v1';

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

  /** Live drag: updates the view from a fixed base tree, saved once on release. */
  preview(base: DockNode, path: number[], index: number, delta: number): void {
    this.tree = resizeAt(base, path, index, delta);
  }

  resize(path: number[], index: number, delta: number): void {
    this.commit(resizeAt(this.tree, path, index, delta));
  }

  reset(): void {
    this.commit(defaultLayout());
  }
}

export const dock = new DockStore();
