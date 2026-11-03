import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../fs-client', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock('../ui/toast.svelte', () => ({ showToast: vi.fn() }));
vi.mock('../lsp/lsp-manager.svelte', () => ({ lsp: { opened: vi.fn(), closed: vi.fn() } }));

import { readTextFile } from '../fs-client';
import { lsp } from '../lsp/lsp-manager.svelte';
import { Tabs } from './tabs.svelte';

const read = vi.mocked(readTextFile);
const opened = vi.mocked(lsp.opened);
const closed = vi.mocked(lsp.closed);

beforeEach(() => {
  opened.mockClear();
  closed.mockClear();
  read.mockReset();
  read.mockResolvedValue({ content: 'a', eol: 'lf', readonly: false, reason: null });
});

describe('tabs -> lsp ref counts', () => {
  it('open counts once even if reopened/focused again', async () => {
    const t = new Tabs();
    await t.openFile('/p/a.ts');
    await t.openFile('/p/a.ts');
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith('/p/a.ts');
  });

  it('close calls closed', async () => {
    const t = new Tabs();
    await t.openFile('/p/a.ts');
    await t.closeTab('/p/a.ts', async () => true);
    expect(closed).toHaveBeenCalledWith('/p/a.ts');
  });

  it('declined dirty close does not call closed', async () => {
    const t = new Tabs();
    await t.openFile('/p/a.ts');
    t.setContent('/p/a.ts', 'b');
    await t.closeTab('/p/a.ts', async () => false);
    expect(closed).not.toHaveBeenCalled();
  });

  it('orphan-closing a clean tab calls closed; dirty orphan keeps it open', async () => {
    const t = new Tabs();
    await t.openFile('/p/a.ts');
    await t.openFile('/p/b.ts');
    t.setContent('/p/b.ts', 'dirty');
    t.orphan('/p/a.ts');
    t.orphan('/p/b.ts');
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith('/p/a.ts');
  });

  it('retarget closes the old path and opens the new one', async () => {
    const t = new Tabs();
    await t.openFile('/p/a.ts');
    opened.mockClear();
    t.retarget('/p/a.ts', '/p/b.py');
    expect(closed).toHaveBeenCalledWith('/p/a.ts');
    expect(opened).toHaveBeenCalledWith('/p/b.py');
  });

  it('restored (hot exit) tabs are counted', () => {
    const t = new Tabs();
    t.openRestored('/p/a.ts', 'x', 'y', 'lf', false);
    expect(opened).toHaveBeenCalledWith('/p/a.ts');
  });

  it('diff/doc/heatmap/transcript tabs are not counted', () => {
    const t = new Tabs();
    t.openDiff('diff:1', 'd', { old: '', new: '', binary: false, langPath: 'a.ts' });
    t.openDoc('doc:1', 'd', '# x');
    t.openHeatmap();
    t.openTranscript('/p', { id: 's', title: 't' });
    void t.closeTab('diff:1', async () => true);
    void t.closeTab('heatmap:', async () => true);
    expect(opened).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
});
