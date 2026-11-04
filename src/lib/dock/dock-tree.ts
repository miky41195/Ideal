/** Pure layout model for the block workspace: a tree of splits whose leaves are tab groups. */

export const ALL_BLOCKS = ['claude', 'editor', 'terminal', 'explorer', 'git', 'changes', 'search', 'notes', 'hub'] as const;
export type BlockId = (typeof ALL_BLOCKS)[number];

export interface Group {
  type: 'group';
  id: string;
  blocks: BlockId[];
  active: BlockId;
  collapsed?: boolean;
}

export interface Split {
  type: 'split';
  dir: 'row' | 'col';
  /** Fractions of the parent, one per child, summing to 1. */
  sizes: number[];
  children: DockNode[];
}

export type DockNode = Group | Split;
export type Zone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Handle {
  /** Child indexes from the root to the split this handle belongs to. */
  path: number[];
  /** Index of the child left of (or above) the handle. */
  index: number;
  dir: 'row' | 'col';
  rect: Rect;
  /** Pixels available along the split axis, to turn a drag into a fraction. */
  span: number;
}

export const MIN_SHARE = 0.1;

export function defaultLayout(): DockNode {
  return {
    type: 'split',
    dir: 'row',
    sizes: [0.22, 0.78],
    children: [
      { type: 'group', id: 'g1', blocks: ['explorer', 'git', 'changes', 'search', 'notes', 'hub'], active: 'explorer' },
      {
        type: 'split',
        dir: 'col',
        sizes: [0.72, 0.28],
        children: [
          { type: 'group', id: 'g2', blocks: ['claude', 'editor'], active: 'claude' },
          { type: 'group', id: 'g3', blocks: ['terminal'], active: 'terminal' },
        ],
      },
    ],
  };
}

/** Ready-made arrangements. */
export const PRESETS: { id: string; label: string; build: () => DockNode }[] = [
  {
    id: 'focus',
    label: 'Focus Claude',
    build: () => setCollapsed(setCollapsed(defaultLayout(), 'g1', true), 'g3', true),
  },
  {
    id: 'review',
    label: 'Revisione',
    build: () => ({
      type: 'split',
      dir: 'row',
      sizes: [0.22, 0.48, 0.3],
      children: [
        { type: 'group', id: 'g1', blocks: ['changes', 'git', 'explorer', 'search', 'notes', 'hub'], active: 'changes' },
        { type: 'group', id: 'g2', blocks: ['editor'], active: 'editor' },
        {
          type: 'split',
          dir: 'col',
          sizes: [0.7, 0.3],
          children: [
            { type: 'group', id: 'g3', blocks: ['claude'], active: 'claude' },
            { type: 'group', id: 'g4', blocks: ['terminal'], active: 'terminal' },
          ],
        },
      ],
    }),
  },
];

export function allGroups(n: DockNode): Group[] {
  return n.type === 'group' ? [n] : n.children.flatMap(allGroups);
}

export function findGroup(n: DockNode, block: BlockId): Group | undefined {
  return allGroups(n).find((g) => g.blocks.includes(block));
}

export function isVisible(n: DockNode, block: BlockId): boolean {
  const g = findGroup(n, block);
  return !!g && !g.collapsed && g.active === block;
}

function shown(n: DockNode): boolean {
  return n.type === 'group' ? !n.collapsed : n.children.some(shown);
}

export function layoutRects(root: DockNode, area: Rect, gap: number): { groups: { group: Group; rect: Rect }[]; handles: Handle[] } {
  const groups: { group: Group; rect: Rect }[] = [];
  const handles: Handle[] = [];

  const walk = (n: DockNode, r: Rect, path: number[]) => {
    if (n.type === 'group') {
      if (!n.collapsed) groups.push({ group: n, rect: r });
      return;
    }
    const items = n.children.map((child, i) => ({ child, i, size: n.sizes[i] })).filter((c) => shown(c.child));
    if (!items.length) return;
    const total = items.reduce((a, c) => a + c.size, 0);
    const row = n.dir === 'row';
    const span = (row ? r.w : r.h) - gap * (items.length - 1);
    let at = row ? r.x : r.y;
    items.forEach((c, k) => {
      const len = (c.size / total) * span;
      walk(c.child, row ? { x: at, y: r.y, w: len, h: r.h } : { x: r.x, y: at, w: r.w, h: len }, [...path, c.i]);
      at += len;
      if (k < items.length - 1) {
        handles.push({
          path,
          index: c.i,
          dir: n.dir,
          rect: row ? { x: at, y: r.y, w: gap, h: r.h } : { x: r.x, y: at, w: r.w, h: gap },
          span,
        });
        at += gap;
      }
    });
  };

  walk(root, area, []);
  return { groups, handles };
}

function mapGroups(n: DockNode, f: (g: Group) => Group): DockNode {
  if (n.type === 'group') return f(n);
  return { ...n, children: n.children.map((c) => mapGroups(c, f)) };
}

export function activate(root: DockNode, block: BlockId): DockNode {
  return mapGroups(root, (g) => (g.blocks.includes(block) ? { ...g, active: block, collapsed: false } : g));
}

export function setCollapsed(root: DockNode, groupId: string, collapsed: boolean): DockNode {
  return mapGroups(root, (g) => (g.id === groupId ? { ...g, collapsed } : g));
}

/** Drops empty groups and flattens splits left with one child or nested in the same direction. */
function prune(n: DockNode): DockNode | null {
  if (n.type === 'group') return n.blocks.length ? n : null;
  const kept: { node: DockNode; size: number }[] = [];
  n.children.forEach((c, i) => {
    const p = prune(c);
    if (!p) return;
    if (p.type === 'split' && p.dir === n.dir) {
      p.children.forEach((gc, j) => kept.push({ node: gc, size: n.sizes[i] * p.sizes[j] }));
    } else kept.push({ node: p, size: n.sizes[i] });
  });
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0].node;
  const total = kept.reduce((a, k) => a + k.size, 0);
  return { ...n, children: kept.map((k) => k.node), sizes: kept.map((k) => k.size / total) };
}

function nextGroupId(root: DockNode): string {
  const max = allGroups(root).reduce((m, g) => Math.max(m, Number(g.id.replace(/\D/g, '')) || 0), 0);
  return `g${max + 1}`;
}

function replaceGroup(n: DockNode, id: string, f: (g: Group) => DockNode): DockNode {
  if (n.type === 'group') return n.id === id ? f(n) : n;
  return { ...n, children: n.children.map((c) => replaceGroup(c, id, f)) };
}

const zoneDir = (z: Zone): 'row' | 'col' => (z === 'left' || z === 'right' ? 'row' : 'col');
const zoneFirst = (z: Zone) => z === 'left' || z === 'top';

/** Moves a block to a tab position (`center`) or to a side of a group; `root` targets the window edge. */
export function moveBlock(root: DockNode, block: BlockId, target: string, zone: Zone): DockNode {
  const from = findGroup(root, block);
  if (!from) return root;
  if (from.id === target && (zone === 'center' || from.blocks.length === 1)) return root;
  if (target !== 'root' && !allGroups(root).some((g) => g.id === target)) return root;

  const fresh: Group = { type: 'group', id: nextGroupId(root), blocks: [block], active: block };

  // Detach first; the target survives because an emptied source is only pruned afterwards.
  const detached = mapGroups(root, (g) => {
    if (g.id !== from.id) return g;
    const blocks = g.blocks.filter((b) => b !== block);
    const i = g.blocks.indexOf(block);
    return { ...g, blocks, active: g.active === block ? (blocks[Math.max(0, i - 1)] ?? g.active) : g.active };
  });

  let placed: DockNode;
  if (target === 'root') {
    const pair = zoneFirst(zone) ? [fresh, detached] : [detached, fresh];
    const sizes = zoneFirst(zone) ? [0.25, 0.75] : [0.75, 0.25];
    placed = { type: 'split', dir: zoneDir(zone === 'center' ? 'right' : zone), sizes, children: pair };
  } else if (zone === 'center') {
    placed = mapGroups(detached, (g) =>
      g.id === target ? { ...g, blocks: [...g.blocks, block], active: block, collapsed: false } : g,
    );
  } else {
    placed = replaceGroup(detached, target, (g) => ({
      type: 'split',
      dir: zoneDir(zone),
      sizes: [0.5, 0.5],
      children: zoneFirst(zone) ? [fresh, g] : [g, fresh],
    }));
  }
  return prune(placed) ?? root;
}

function atPath(n: DockNode, path: number[], f: (s: Split) => Split): DockNode {
  if (n.type !== 'split') return n;
  if (!path.length) return f(n);
  const [head, ...rest] = path;
  return { ...n, children: n.children.map((c, i) => (i === head ? atPath(c, rest, f) : c)) };
}

/** Shifts `delta` of the split's share from the child after `index` to the child at `index`. */
export function resizeAt(root: DockNode, path: number[], index: number, delta: number, min = MIN_SHARE): DockNode {
  return atPath(root, path, (s) => {
    const next = s.children.findIndex((c, i) => i > index && shown(c));
    if (next < 0) return s;
    const pair = s.sizes[index] + s.sizes[next];
    const a = Math.min(pair - min, Math.max(min, s.sizes[index] + delta));
    const sizes = [...s.sizes];
    sizes[index] = a;
    sizes[next] = pair - a;
    return { ...s, sizes };
  });
}

/** Which drop zone a pointer is in: outer quarter of each axis is an edge, the rest is the tab area. */
export function zoneAt(r: Rect, x: number, y: number): Zone {
  const dx = (x - r.x) / r.w;
  const dy = (y - r.y) / r.h;
  const edges: [number, Zone][] = [
    [dx, 'left'],
    [1 - dx, 'right'],
    [dy, 'top'],
    [1 - dy, 'bottom'],
  ];
  const [d, z] = edges.reduce((a, b) => (b[0] < a[0] ? b : a));
  return d < 0.25 ? z : 'center';
}

/** Where a block would land, for the live preview. */
export function zoneRect(r: Rect, z: Zone): Rect {
  switch (z) {
    case 'left':
      return { ...r, w: r.w / 2 };
    case 'right':
      return { ...r, x: r.x + r.w / 2, w: r.w / 2 };
    case 'top':
      return { ...r, h: r.h / 2 };
    case 'bottom':
      return { ...r, y: r.y + r.h / 2, h: r.h / 2 };
    default:
      return r;
  }
}

function clean(raw: unknown, seen: Set<BlockId>): DockNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (n.type === 'group') {
    if (typeof n.id !== 'string' || !Array.isArray(n.blocks)) return null;
    const blocks: BlockId[] = [];
    for (const b of n.blocks) {
      if ((ALL_BLOCKS as readonly unknown[]).includes(b) && !seen.has(b as BlockId)) {
        seen.add(b as BlockId);
        blocks.push(b as BlockId);
      }
    }
    if (!blocks.length) return null;
    const active = blocks.includes(n.active as BlockId) ? (n.active as BlockId) : blocks[0];
    return { type: 'group', id: n.id, blocks, active, collapsed: n.collapsed === true };
  }
  if (n.type === 'split') {
    if ((n.dir !== 'row' && n.dir !== 'col') || !Array.isArray(n.children) || !Array.isArray(n.sizes)) return null;
    if (n.sizes.length !== n.children.length) return null;
    const sizes = n.sizes.map(Number);
    if (sizes.some((s) => !(s > 0))) return null;
    const children = n.children.map((c) => clean(c, seen) ?? ({ type: 'group', id: '', blocks: [], active: 'claude' } as Group));
    return { type: 'split', dir: n.dir, sizes, children };
  }
  return null;
}

/** Validates a stored layout; a block it lacks lands beside the file tree, or with Claude, so nothing becomes unreachable. */
export function normalize(raw: unknown): DockNode {
  const seen = new Set<BlockId>();
  const cleaned = clean(raw, seen);
  const tree = cleaned ? prune(cleaned) : null;
  if (!tree || !seen.size) return defaultLayout();
  const missing = ALL_BLOCKS.filter((b) => !seen.has(b));
  if (!missing.length) return tree;
  const home = (findGroup(tree, 'explorer') ?? findGroup(tree, 'claude') ?? allGroups(tree)[0]).id;
  return mapGroups(tree, (g) => (g.id === home ? { ...g, blocks: [...g.blocks, ...missing] } : g));
}
