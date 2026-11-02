import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../fs-client', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { readTextFile, writeTextFile } from '../fs-client';
import { Tabs, dirty, hasUnsaved, remapPath } from './tabs.svelte';

const read = vi.mocked(readTextFile);
const write = vi.mocked(writeTextFile);

beforeEach(() => {
  read.mockReset();
  write.mockReset();
  read.mockResolvedValue({ content: 'a\nb', eol: 'crlf', readonly: false, reason: null });
  write.mockResolvedValue(undefined);
});

describe('Tabs', () => {
  it('save notifies onSaved listeners only on success', async () => {
    const t = new Tabs();
    const cb = vi.fn();
    t.onSaved(cb);
    await t.openFile('C:\p\a.ts');
    t.setContent('C:\p\a.ts', 'x');
    await t.save('C:\p\a.ts');
    expect(cb).toHaveBeenCalledTimes(1);
    write.mockRejectedValueOnce('boom');
    t.setContent('C:\p\a.ts', 'y');
    await t.save('C:\p\a.ts');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('doc and file tabs never share a slot', async () => {
    const t = new Tabs();
    t.openDoc('md:C:\\p\\a.md', 'a', '# a', 'C:\\p\\a.md');
    await t.openFile('C:\\p\\a.md');
    expect(t.tabs).toHaveLength(2);
    expect(new Set(t.tabs.map((x) => x.path)).size).toBe(2);
    const u = new Tabs();
    await u.openFile('C:\\p\\b.md');
    u.setContent('C:\\p\\b.md', 'edited');
    u.openDoc('C:\\p\\b.md', 'b', '# doc');
    const file = u.tabs.find((x) => x.kind === 'file')!;
    expect(file.content).toBe('edited');
    expect(file.doc).toBeUndefined();
    expect(u.tabs.filter((x) => x.kind === 'doc')).toHaveLength(1);
  });

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

describe('unsaved / retarget / orphan', () => {
  it('hasUnsaved detects dirty tabs', async () => {
    const t = new Tabs();
    await t.openFile('C:\\p\\a.ts');
    expect(hasUnsaved(t.tabs)).toBe(false);
    t.setContent('C:\\p\\a.ts', 'x');
    expect(hasUnsaved(t.tabs)).toBe(true);
  });

  it('remapPath respects separators', () => {
    expect(remapPath('C:\\p\\d', 'C:\\p\\d', 'C:\\p\\e')).toBe('C:\\p\\e');
    expect(remapPath('C:\\p\\d\\a.ts', 'C:\\p\\d', 'C:\\p\\e')).toBe('C:\\p\\e\\a.ts');
    expect(remapPath('C:\\p\\dx\\a.ts', 'C:\\p\\d', 'C:\\p\\e')).toBeNull();
  });

  it('retarget renames a file tab, errors and active path', async () => {
    const t = new Tabs();
    await t.openFile('C:\\p\\a.ts');
    t.errors['C:\\p\\a.ts'] = 'boom';
    t.retarget('C:\\p\\a.ts', 'C:\\p\\b.ts');
    expect(t.tabs[0].path).toBe('C:\\p\\b.ts');
    expect(t.tabs[0].name).toBe('b.ts');
    expect(t.activePath).toBe('C:\\p\\b.ts');
    expect(t.errors['C:\\p\\b.ts']).toBe('boom');
    expect(t.errors['C:\\p\\a.ts']).toBeUndefined();
  });

  it('retarget folder prefix moves nested tabs only', async () => {
    const t = new Tabs();
    await t.openFile('C:\\p\\d\\a.ts');
    await t.openFile('C:\\p\\dx\\b.ts');
    const seen: string[] = [];
    t.onRetarget((f, to) => seen.push(`${f}>${to}`));
    t.retarget('C:\\p\\d', 'C:\\p\\e');
    expect(t.tabs.map((x) => x.path)).toEqual(['C:\\p\\e\\a.ts', 'C:\\p\\dx\\b.ts']);
    expect(seen).toEqual(['C:\\p\\d>C:\\p\\e']);
  });

  it('orphan closes clean tabs and flags dirty ones', async () => {
    const t = new Tabs();
    await t.openFile('C:\\p\\d\\a.ts');
    await t.openFile('C:\\p\\d\\b.ts');
    t.setContent('C:\\p\\d\\b.ts', 'changed');
    t.orphan('C:\\p\\d');
    expect(t.tabs.map((x) => x.path)).toEqual(['C:\\p\\d\\b.ts']);
    expect(t.tabs[0].orphaned).toBe(true);
    await t.save('C:\\p\\d\\b.ts');
    expect(t.tabs[0].orphaned).toBe(false);
  });
});

describe('diff and heatmap tabs', () => {
  const d = { old: 'a', new: 'b', binary: false, langPath: 'src/a.ts' };

  it('openDiff twice with same id keeps one tab and updates content', () => {
    const t = new Tabs();
    t.openDiff('diff:staged:src/a.ts', 'a.ts (HEAD ↔ Indice)', d);
    t.openDiff('diff:staged:src/a.ts', 'a.ts (HEAD ↔ Indice)', { ...d, new: 'c' });
    expect(t.tabs).toHaveLength(1);
    expect(t.tabs[0].kind).toBe('diff');
    expect(t.tabs[0].diff?.new).toBe('c');
    expect(t.activePath).toBe('diff:staged:src/a.ts');
  });

  it('diff tab is never unsaved and save/saveAll ignore it', async () => {
    const t = new Tabs();
    t.openDiff('diff:x', 'x', d);
    t.tabs[0].content = 'changed';
    expect(hasUnsaved(t.tabs)).toBe(false);
    await t.save('diff:x');
    await t.saveAll();
    expect(write).not.toHaveBeenCalled();
  });

  it('retarget and orphan skip non-file tabs', () => {
    const t = new Tabs();
    t.openDiff('diff:x', 'x', d);
    t.openHeatmap();
    t.retarget('diff:x', 'zzz');
    t.orphan('heatmap:');
    expect(t.tabs.map((x) => x.path)).toEqual(['diff:x', 'heatmap:']);
  });

  it('openHeatmap is a singleton', () => {
    const t = new Tabs();
    t.openHeatmap();
    t.openHeatmap();
    expect(t.tabs).toHaveLength(1);
    expect(t.tabs[0].kind).toBe('heatmap');
    expect(t.tabs[0].name).toBe('Heatmap');
    expect(t.activePath).toBe('heatmap:');
  });
});

describe('file/diff interplay', () => {
  const d = { old: 'a', new: 'b', binary: false, langPath: 'a.ts' };

  it('activeFileTab falls back to the last active file tab behind a diff', async () => {
    const t = new Tabs();
    await t.openFile('C:\p\a.ts');
    await t.openFile('C:\p\b.ts');
    await t.openFile('C:\p\a.ts');
    t.openDiff('diff:x', 'x', d);
    expect(t.active?.kind).toBe('diff');
    expect(t.activeFileTab?.path).toBe('C:\p\a.ts');
    t.openHeatmap();
    expect(t.activeFileTab?.path).toBe('C:\p\a.ts');
    t.select('C:\p\b.ts');
    expect(t.activeFileTab?.path).toBe('C:\p\b.ts');
  });

  it('openFile is unaffected by an existing diff tab', async () => {
    const t = new Tabs();
    t.openDiff('diff:x', 'x', d);
    await t.openFile('C:\p\a.ts');
    expect(t.tabs).toHaveLength(2);
    expect(t.active?.kind).toBe('file');
  });

  it('closeTab on a diff tab never prompts; setContent ignored', async () => {
    const t = new Tabs();
    t.openDiff('diff:x', 'x', d);
    t.setContent('diff:x', 'zzz');
    expect(t.tabs[0].content).toBe('');
    const confirm = vi.fn().mockResolvedValue(false);
    await t.closeTab('diff:x', confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(t.tabs).toHaveLength(0);
  });

  it('doc and transcript tabs are singleton, readonly, never dirty, not saved', async () => {
    const t = new Tabs();
    t.openDoc('doc:a', 'A', '# a');
    t.openDoc('doc:a', 'A2', '# b');
    t.openTranscript('/p', { id: 's1', title: 'Sessione' });
    t.openTranscript('/p', { id: 's1', title: 'Sessione' });
    expect(t.tabs).toHaveLength(2);
    expect(t.tabs[0].doc?.markdown).toBe('# b');
    expect(t.tabs[1].path).toBe('transcript:s1');
    expect(t.tabs[1].transcript).toEqual({ projectPath: '/p', sessionId: 's1', title: 'Sessione' });
    expect(hasUnsaved(t.tabs)).toBe(false);
    t.setContent('doc:a', 'x');
    await t.save('doc:a');
    expect(write).not.toHaveBeenCalled();
    expect(t.activeFileTab).toBeUndefined();
  });
});
