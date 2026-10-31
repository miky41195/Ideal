import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../fs-client', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { readTextFile, writeTextFile } from '../fs-client';
import { Tabs, dirty } from './tabs.svelte';

const read = vi.mocked(readTextFile);
const write = vi.mocked(writeTextFile);

beforeEach(() => {
  read.mockReset();
  write.mockReset();
  read.mockResolvedValue({ content: 'a\nb', eol: 'crlf', readonly: false, reason: null });
  write.mockResolvedValue(undefined);
});

describe('Tabs', () => {
  it('opening the same path twice yields one tab', async () => {
    const t = new Tabs();
    await t.openFile('C:\\p\\a.ts');
    await t.openFile('C:\\p\\a.ts');
    expect(t.tabs).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(t.active?.name).toBe('a.ts');
  });

  it('edit makes dirty, save writes with eol and clears dirty', async () => {
    const t = new Tabs();
    await t.openFile('C:\\p\\a.ts');
    t.setContent('C:\\p\\a.ts', 'a\nb\nc');
    expect(dirty(t.tabs[0])).toBe(true);
    await t.save('C:\\p\\a.ts');
    expect(write).toHaveBeenCalledWith('C:\\p\\a.ts', 'a\nb\nc', 'crlf');
    expect(dirty(t.tabs[0])).toBe(false);
  });

  it('closing a dirty tab with confirm=false keeps it', async () => {
    const t = new Tabs();
    await t.openFile('x.ts');
    t.setContent('x.ts', 'changed');
    await t.closeTab('x.ts', async () => false);
    expect(t.tabs).toHaveLength(1);
    await t.closeTab('x.ts', async () => true);
    expect(t.tabs).toHaveLength(0);
    expect(t.active).toBeUndefined();
  });

  it('save on a readonly tab is a no-op', async () => {
    read.mockResolvedValue({ content: '', eol: 'lf', readonly: true, reason: 'binario' });
    const t = new Tabs();
    await t.openFile('img.png');
    t.setContent('img.png', 'x');
    await t.save('img.png');
    expect(write).not.toHaveBeenCalled();
    expect(t.tabs[0].reason).toBe('binario');
  });

  it('save failure keeps buffer dirty and sets error', async () => {
    const t = new Tabs();
    await t.openFile('x.ts');
    t.setContent('x.ts', 'new');
    write.mockRejectedValue('file di sola lettura');
    await t.save('x.ts');
    expect(dirty(t.tabs[0])).toBe(true);
    expect(t.errors['x.ts']).toContain('sola lettura');
  });

  it('saveAll keeps a failed tab dirty with its error, cleans the others', async () => {
    const t = new Tabs();
    await t.openFile('one.ts');
    await t.openFile('two.ts');
    t.setContent('one.ts', 'x1');
    t.setContent('two.ts', 'x2');
    write.mockImplementation(async (p: string) => {
      if (p === 'one.ts') throw 'boom';
    });
    await t.saveAll();
    expect(dirty(t.tabs[0])).toBe(true);
    expect(dirty(t.tabs[1])).toBe(false);
    expect(t.errors['one.ts']).toContain('boom');
    expect(t.errorMessage).toContain('boom');
    // a later successful open does not wipe it
    await t.openFile('three.ts');
    expect(t.errors['one.ts']).toBeDefined();
  });

  it('openFile failure sets openError', async () => {
    read.mockRejectedValue('nope');
    const t = new Tabs();
    await t.openFile('bad.ts');
    expect(t.tabs).toHaveLength(0);
    expect(t.openError).toContain('nope');
  });

  it('closing the active tab activates a neighbour', async () => {
    const t = new Tabs();
    await t.openFile('a');
    await t.openFile('b');
    await t.openFile('c');
    await t.closeTab('c', async () => true);
    expect(t.activePath).toBe('b');
    await t.closeTab('a', async () => true);
    expect(t.activePath).toBe('b');
  });

  it('save guard: readonly tab with differing content never writes', async () => {
    const t = new Tabs();
    t.tabs.push({ path: 'r', name: 'r', content: 'new', savedContent: 'old', eol: 'lf', readonly: true });
    await t.save('r');
    await t.saveAll();
    expect(write).not.toHaveBeenCalled();
  });
});
