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
    expect(t.error).toContain('sola lettura');
  });
});
