import type { DirEntry } from '../fs-client';

export type Node = {
  path: string;
  name: string;
  isDir: boolean;
  expanded?: boolean;
  children?: Node[];
};

export type Loader = (path: string) => Promise<DirEntry[]>;

const toNode = (e: DirEntry): Node => ({ path: e.path, name: e.name, isDir: e.isDir });

export function findNode(nodes: Node[], path: string): Node | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const f = findNode(n.children, path);
      if (f) return f;
    }
  }
  return undefined;
}

function mapNode(nodes: Node[], path: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) => {
    if (n.path === path) return fn(n);
    if (n.children) return { ...n, children: mapNode(n.children, path, fn) };
    return n;
  });
}

/** Expands/collapses a dir; children are loaded lazily on first expand only. */
export async function toggle(nodes: Node[], path: string, load: Loader): Promise<Node[]> {
  const node = findNode(nodes, path);
  if (!node || !node.isDir) return nodes;
  if (node.expanded) return mapNode(nodes, path, (n) => ({ ...n, expanded: false }));
  if (node.children) return mapNode(nodes, path, (n) => ({ ...n, expanded: true }));
  const entries = await load(path);
  return mapNode(nodes, path, (n) => ({ ...n, expanded: true, children: entries.map(toNode) }));
}

/** Replaces a dir's children with fresh entries, preserving state of surviving dirs. */
export function replaceChildren(nodes: Node[], path: string, entries: DirEntry[]): Node[] {
  return mapNode(nodes, path, (n) => {
    const old = new Map((n.children ?? []).map((c) => [c.path, c]));
    const children = entries.map((e) => {
      const prev = old.get(e.path);
      return prev && prev.isDir && e.isDir ? { ...prev, name: e.name } : toNode(e);
    });
    return { ...n, children };
  });
}
