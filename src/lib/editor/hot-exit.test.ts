import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../fs-client', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock('../ui/toast.svelte', () => ({ showToast: vi.fn() }));

import { readTextFile } from '../fs-client';
import { Tabs, dirty } from './tabs.svelte';
import { createBackupScheduler, restoreBackups, type Backup } from './hot-exit';

const read = vi.mocked(readTextFile);

describe('createBackupScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const mk = () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    return { write, clear, s: createBackupScheduler(write, clear, 1000) };
  };

  it('debounce coalesces writes per path', async () => {
    const { write, s } = mk();
    s.changed('a', '1', 'lf');
    s.changed('a', '12', 'lf');
    s.changed('b', 'x', 'crlf');
    await vi.advanceTimersByTimeAsync(999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith('a', '12', 'lf');
    expect(write).toHaveBeenCalledWith('b', 'x', 'crlf');
  });

  it('saved cancels the pending write and clears the backup', async () => {
    const { write, clear, s } = mk();
    s.changed('a', '1', 'lf');
    s.saved('a');
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith('a');
  });

  it('discarded cancels and clears too', async () => {
    const { write, clear, s } = mk();
    s.changed('a', '1', 'lf');
    s.discarded('a');
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith('a');
  });

  it('flush writes pending immediately', async () => {
    const { write, s } = mk();
    s.changed('a', '1', 'lf');
    s.changed('b', '2', 'lf');
    await s.flush();
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(2); // no double write
  });

  it('flush rejects when a write fails', async () => {
    const { write, s } = mk();
    write.mockRejectedValueOnce('disk full');
    s.changed('a', '1', 'lf');
    await expect(s.flush()).rejects.toBeDefined();
  });
});

describe('restoreBackups', () => {
  const bk = (filePath: string, content: string): Backup => ({ filePath, content, eol: 'lf', savedAt: 1 });
  beforeEach(() => {
    read.mockReset();
  });

  it('restore_against_current_disk: buffer stays dirty against the current disk text', async () => {
    read.mockResolvedValue({ content: 'disk NEW', eol: 'lf', readonly: false, reason: null });
    const t = new Tabs();
    const n = await restoreBackups(t, [bk('/p/a.ts', 'my edit')]);
    expect(n).toBe(1);
    const tab = t.tabs[0];
    expect(tab.content).toBe('my edit');
    expect(tab.savedContent).toBe('disk NEW');
    expect(dirty(tab)).toBe(true);
    expect(tab.orphaned).toBeFalsy();
    expect(tab.diskConflict).toBeUndefined();
  });

  it('missing disk file: tab is flagged deleted and dirty', async () => {
    read.mockImplementation(async () => { throw new Error('os error 2'); });
    const t = new Tabs();
    expect(await restoreBackups(t, [bk('/p/gone.ts', 'x')])).toBe(1);
    expect(t.tabs[0].orphaned).toBe(true);
    expect(t.tabs[0].savedContent).toBe('');
    expect(dirty(t.tabs[0])).toBe(true);
  });

  it('skips backups equal to disk and returns only restored count', async () => {
    read.mockResolvedValue({ content: 'same', eol: 'lf', readonly: false, reason: null });
    const t = new Tabs();
    expect(await restoreBackups(t, [bk('/p/a.ts', 'same')])).toBe(0);
    expect(t.tabs).toHaveLength(0);
  });
});

describe('Tabs backup sink', () => {
  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue({ content: 'a', eol: 'lf', readonly: false, reason: null });
  });
  it('reports dirty edits, clean edits, and discards', async () => {
    const t = new Tabs();
    const sink = { changed: vi.fn(), saved: vi.fn(), discarded: vi.fn() };
    t.setBackupSink(sink);
    await t.openFile('/p/a.ts');
    t.setContent('/p/a.ts', 'b');
    expect(sink.changed).toHaveBeenCalledWith('/p/a.ts', 'b', 'lf');
    t.setContent('/p/a.ts', 'a'); // back to saved text
    expect(sink.saved).toHaveBeenCalledWith('/p/a.ts');
    t.setContent('/p/a.ts', 'c');
    await t.closeTab('/p/a.ts', async () => true);
    expect(sink.discarded).toHaveBeenCalledWith('/p/a.ts');
  });
});
