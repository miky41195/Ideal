import { describe, expect, it } from 'vitest';
import {
  ALL_BLOCKS,
  activate,
  allGroups,
  defaultLayout,
  findGroup,
  isVisible,
  layoutRects,
  moveBlock,
  normalize,
  resizeAt,
  setCollapsed,
  zoneAt,
  type DockNode,
  type Group,
} from './dock-tree';

const stage = { x: 0, y: 0, w: 1000, h: 600 };

function blockCount(n: DockNode): string[] {
  return allGroups(n).flatMap((g) => g.blocks);
}

describe('defaultLayout', () => {
  it('holds every block exactly once', () => {
    expect(blockCount(defaultLayout()).sort()).toEqual([...ALL_BLOCKS].sort());
  });

  it('keeps Claude as the active block of the main group', () => {
    const g = findGroup(defaultLayout(), 'claude')!;
    expect(g.active).toBe('claude');
    expect(g.blocks).toContain('editor');
  });
});

describe('layoutRects', () => {
  const row: DockNode = {
    type: 'split',
    dir: 'row',
    sizes: [0.25, 0.75],
    children: [
      { type: 'group', id: 'a', blocks: ['explorer'], active: 'explorer' },
      { type: 'group', id: 'b', blocks: ['claude'], active: 'claude' },
    ],
  };

  it('splits by fraction and leaves the gap between children', () => {
    const { groups } = layoutRects(row, stage, 10);
    const a = groups.find((g) => g.group.id === 'a')!.rect;
    const b = groups.find((g) => g.group.id === 'b')!.rect;
    expect(a.x).toBe(0);
    expect(a.w).toBeCloseTo(247.5);
    expect(b.x).toBeCloseTo(257.5);
    expect(b.x + b.w).toBeCloseTo(1000);
    expect(a.h).toBe(600);
  });

  it('gives a collapsed group space to its sibling', () => {
    const r = setCollapsed(row, 'a', true);
    const { groups, handles } = layoutRects(r, stage, 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].rect.w).toBe(1000);
    expect(handles).toHaveLength(0);
  });

  it('emits one handle per gap', () => {
    const { handles } = layoutRects(row, stage, 10);
    expect(handles).toHaveLength(1);
    expect(handles[0].dir).toBe('row');
    expect(handles[0].rect.x).toBeCloseTo(247.5);
    expect(handles[0].rect.w).toBe(10);
  });
});

describe('moveBlock', () => {
  it('moves a block into another group as a tab', () => {
    const r = moveBlock(defaultLayout(), 'git', findGroup(defaultLayout(), 'claude')!.id, 'center');
    const g = findGroup(r, 'git')!;
    expect(g.blocks).toContain('claude');
    expect(g.active).toBe('git');
    expect(blockCount(r).sort()).toEqual([...ALL_BLOCKS].sort());
  });

  it('creates a side-by-side split on an edge drop', () => {
    const start = defaultLayout();
    const main = findGroup(start, 'claude')!;
    const r = moveBlock(start, 'editor', main.id, 'right');
    const c = findGroup(r, 'claude')!;
    const e = findGroup(r, 'editor')!;
    expect(c.id).not.toBe(e.id);
    expect(e.blocks).toEqual(['editor']);
    const { groups } = layoutRects(r, stage, 6);
    const rc = groups.find((g) => g.group.id === c.id)!.rect;
    const re = groups.find((g) => g.group.id === e.id)!.rect;
    expect(re.x).toBeGreaterThan(rc.x);
    expect(re.y).toBe(rc.y);
  });

  it('removes an emptied group and flattens single-child splits', () => {
    const two: DockNode = {
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { type: 'group', id: 'a', blocks: ['explorer'], active: 'explorer' },
        { type: 'group', id: 'b', blocks: ['claude'], active: 'claude' },
      ],
    };
    const r = moveBlock(two, 'explorer', 'b', 'center');
    expect(r.type).toBe('group');
    expect((r as Group).blocks).toEqual(['claude', 'explorer']);
  });

  it('ignores a drop of a lone block on its own group', () => {
    const one: DockNode = {
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { type: 'group', id: 'a', blocks: ['explorer'], active: 'explorer' },
        { type: 'group', id: 'b', blocks: ['claude'], active: 'claude' },
      ],
    };
    expect(moveBlock(one, 'explorer', 'a', 'left')).toBe(one);
    expect(moveBlock(one, 'explorer', 'a', 'center')).toBe(one);
  });

  it('splits its own group when other tabs remain', () => {
    const start = defaultLayout();
    const left = findGroup(start, 'explorer')!;
    const r = moveBlock(start, 'git', left.id, 'bottom');
    expect(findGroup(r, 'git')!.id).not.toBe(findGroup(r, 'explorer')!.id);
    expect(blockCount(r).sort()).toEqual([...ALL_BLOCKS].sort());
  });

  it('docks on a whole-window edge', () => {
    const r = moveBlock(defaultLayout(), 'terminal', 'root', 'right');
    expect(r.type).toBe('split');
    const s = r as Extract<DockNode, { type: 'split' }>;
    expect(s.dir).toBe('row');
    const last = s.children[s.children.length - 1] as Group;
    expect(last.blocks).toEqual(['terminal']);
  });

  it('keeps sizes summing to one after every move', () => {
    let r = defaultLayout();
    r = moveBlock(r, 'editor', findGroup(r, 'claude')!.id, 'left');
    r = moveBlock(r, 'notes', findGroup(r, 'terminal')!.id, 'right');
    r = moveBlock(r, 'terminal', findGroup(r, 'explorer')!.id, 'center');
    const walk = (n: DockNode) => {
      if (n.type !== 'split') return;
      expect(n.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      expect(n.sizes).toHaveLength(n.children.length);
      n.children.forEach(walk);
    };
    walk(r);
  });

  it('selects a neighbour when the active tab leaves', () => {
    const start = defaultLayout();
    const left = findGroup(start, 'explorer')!;
    const r = moveBlock(start, 'explorer', findGroup(start, 'claude')!.id, 'center');
    const after = allGroups(r).find((g) => g.id === left.id)!;
    expect(after.blocks).toContain(after.active);
    expect(after.active).not.toBe('explorer');
  });
});

describe('activate and visibility', () => {
  it('shows a block and reopens its collapsed group', () => {
    const start = defaultLayout();
    const left = findGroup(start, 'git')!;
    const r = activate(setCollapsed(start, left.id, true), 'git');
    const g = findGroup(r, 'git')!;
    expect(g.active).toBe('git');
    expect(g.collapsed).toBeFalsy();
    expect(isVisible(r, 'git')).toBe(true);
    expect(isVisible(r, 'explorer')).toBe(false);
  });

  it('reports blocks in a collapsed group as hidden', () => {
    const start = defaultLayout();
    const r = setCollapsed(start, findGroup(start, 'terminal')!.id, true);
    expect(isVisible(r, 'terminal')).toBe(false);
  });
});

describe('resizeAt', () => {
  const row: DockNode = {
    type: 'split',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'group', id: 'a', blocks: ['explorer'], active: 'explorer' },
      { type: 'group', id: 'b', blocks: ['claude'], active: 'claude' },
    ],
  };

  it('moves share between the two neighbours', () => {
    const r = resizeAt(row, [], 0, 0.2, 0.1) as Extract<DockNode, { type: 'split' }>;
    expect(r.sizes[0]).toBeCloseTo(0.7);
    expect(r.sizes[1]).toBeCloseTo(0.3);
  });

  it('stops at the minimum share', () => {
    const r = resizeAt(row, [], 0, 0.9, 0.1) as Extract<DockNode, { type: 'split' }>;
    expect(r.sizes[1]).toBeCloseTo(0.1);
    expect(r.sizes[0]).toBeCloseTo(0.9);
  });
});

describe('zoneAt', () => {
  const r = { x: 100, y: 100, w: 400, h: 200 };
  it('reads the edge bands and the centre', () => {
    expect(zoneAt(r, 110, 200)).toBe('left');
    expect(zoneAt(r, 490, 200)).toBe('right');
    expect(zoneAt(r, 300, 110)).toBe('top');
    expect(zoneAt(r, 300, 290)).toBe('bottom');
    expect(zoneAt(r, 300, 200)).toBe('center');
  });
});

describe('normalize', () => {
  it('falls back to the default on junk', () => {
    expect(blockCount(normalize('nope')).sort()).toEqual([...ALL_BLOCKS].sort());
    expect(blockCount(normalize({ type: 'group', id: 'a', blocks: [], active: 'x' })).sort()).toEqual([...ALL_BLOCKS].sort());
  });

  it('restores a block missing from a stored layout', () => {
    const stored: DockNode = {
      type: 'split',
      dir: 'row',
      sizes: [0.5, 0.5],
      children: [
        { type: 'group', id: 'a', blocks: ['explorer'], active: 'explorer' },
        { type: 'group', id: 'b', blocks: ['claude', 'editor', 'terminal', 'git', 'search', 'notes'], active: 'claude' },
      ],
    };
    const r = normalize(JSON.parse(JSON.stringify(stored)));
    expect(blockCount(r).sort()).toEqual([...ALL_BLOCKS].sort());
    expect(findGroup(r, 'explorer')!.id).toBe('a');
  });

  it('drops duplicates and unknown blocks', () => {
    const r = normalize({
      type: 'group',
      id: 'a',
      blocks: [...ALL_BLOCKS, 'claude', 'ghost'],
      active: 'ghost',
    });
    expect(blockCount(r).sort()).toEqual([...ALL_BLOCKS].sort());
    expect((r as Group).active).toBe('claude');
  });
});
