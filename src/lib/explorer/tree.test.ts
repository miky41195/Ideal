import { describe, it, expect, vi } from 'vitest';
import { toggle, replaceChildren, findNode, type Node } from './tree';

const entries = [
  { name: 'a', path: 'r/a', isDir: true },
  { name: 'f.txt', path: 'r/f.txt', isDir: false },
];

describe('tree', () => {
  it('toggle loads once on first expand and collapses without reloading', async () => {
    const load = vi.fn().mockResolvedValue(entries);
    let nodes: Node[] = [{ path: 'r', name: 'r', isDir: true }];
    nodes = await toggle(nodes, 'r', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(nodes[0].expanded).toBe(true);
    expect(nodes[0].children?.map((c) => c.name)).toEqual(['a', 'f.txt']);
    nodes = await toggle(nodes, 'r', load);
    expect(nodes[0].expanded).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    nodes = await toggle(nodes, 'r', load);
    expect(nodes[0].expanded).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('replaceChildren keeps expanded state of surviving dirs', () => {
    const nodes: Node[] = [
      {
        path: 'r', name: 'r', isDir: true, expanded: true,
        children: [{ path: 'r/a', name: 'a', isDir: true, expanded: true, children: [] }],
      },
    ];
    const out = replaceChildren(nodes, 'r', entries);
    const a = findNode(out, 'r/a');
    expect(a?.expanded).toBe(true);
    expect(a?.children).toEqual([]);
    expect(findNode(out, 'r/f.txt')?.expanded).toBeUndefined();
  });
});
