import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./hub-client', () => ({
  memHealth: vi.fn(),
  memObservations: vi.fn(),
  memSummaries: vi.fn(),
  memSearch: vi.fn(),
  memStartWorker: vi.fn(),
  sessionsList: vi.fn(),
  memoriesList: vi.fn(),
  docsList: vi.fn(),
}));
vi.mock('../settings/settings.svelte', () => ({ settings: { value: { claudeMem: { port: 37777 } } } }));
const openDoc = vi.fn();
vi.mock('../editor/tabs.svelte', () => ({ tabs: { openDoc: (...a: unknown[]) => openDoc(...a) } }));

import * as c from './hub-client';
import { HubState } from './hub-store.svelte';
import { health } from './health.svelte';

const m = vi.mocked(c);
const md = (name: string) => ({ name, path: `/p/${name}`, updated: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  m.memHealth.mockResolvedValue(true);
  m.memObservations.mockResolvedValue({ items: [], hasMore: false });
  m.memSummaries.mockResolvedValue({ items: [], hasMore: false });
  m.sessionsList.mockResolvedValue([]);
  m.memoriesList.mockResolvedValue([md('Feedback.md')]);
  m.docsList.mockResolvedValue([md('Piano.md'), md('altro.md')]);
});

describe('HubState', () => {
  it('isolates section errors (memories ok while mem down)', async () => {
    m.memHealth.mockResolvedValue(false);
    m.memObservations.mockRejectedValue('down');
    const h = new HubState();
    h.projectPath = 'C:/x/Ideal';
    await h.refresh();
    expect(h.memStatus).toBe('down');
    expect(h.memories).toHaveLength(1);
    expect(h.error.memories).toBeNull();
    expect(h.error.observations).toBeTruthy();
  });

  it('passes folder name as claude-mem project', async () => {
    const h = new HubState();
    h.projectPath = 'C:/x/Ideal';
    await h.refresh();
    expect(m.memObservations).toHaveBeenCalledWith(37777, 'Ideal', 0, 30);
  });

  it('filters titles case-insensitively', async () => {
    const h = new HubState();
    h.projectPath = 'C:/x/Ideal';
    await h.refresh();
    await h.search('piano');
    expect(h.filteredDocs.map((d) => d.name)).toEqual(['Piano.md']);
    expect(h.filteredMemories).toHaveLength(0);
  });

  it('search shows claude-mem result as doc tab', async () => {
    m.memSearch.mockResolvedValue('# risultati');
    const h = new HubState();
    h.projectPath = 'C:/x/Ideal';
    await h.search('foo');
    expect(openDoc).toHaveBeenCalledWith('search:foo', 'Ricerca claude-mem: foo', '# risultati');
  });

  it('search failure goes to searchError only', async () => {
    m.memSearch.mockRejectedValue('boom');
    const h = new HubState();
    h.projectPath = 'C:/x/Ideal';
    await h.search('foo');
    expect(h.searchError).toContain('boom');
    expect(h.error.observations).toBeNull();
  });

  describe('refreshOnActivity', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it('skips claude-mem sections unless health.mem is up', async () => {
      const h = new HubState();
      h.projectPath = 'C:/x/Ideal';
      health.mem = 'down';
      h.refreshOnActivity();
      await vi.advanceTimersByTimeAsync(2100);
      expect(m.sessionsList).toHaveBeenCalledTimes(1);
      expect(m.memObservations).not.toHaveBeenCalled();
      health.mem = 'up';
      h.refreshOnActivity();
      await vi.advanceTimersByTimeAsync(2100);
      expect(m.memObservations).toHaveBeenCalledTimes(1);
      expect(m.memHealth).not.toHaveBeenCalled();
      health.mem = 'unknown';
    });
    it('debounces 2s and coalesces', async () => {
      const h = new HubState();
      h.projectPath = 'C:/x/Ideal';
      h.refreshOnActivity();
      h.refreshOnActivity();
      await vi.advanceTimersByTimeAsync(1999);
      expect(m.sessionsList).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(m.sessionsList).toHaveBeenCalledTimes(1);
    });
  });
});
