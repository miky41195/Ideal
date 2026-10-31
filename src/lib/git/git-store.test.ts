import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git-client', () => ({ gitStatus: vi.fn(), gitWatch: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: vi.fn(async () => () => {}) }),
}));

import { gitStatus, type RepoStatus } from './git-client';
import { GitState } from './git-store.svelte';

const st = (branch: string): RepoStatus => ({
  isRepo: true, branch, upstream: null, ahead: 0, behind: 0, files: [],
});
const status = vi.mocked(gitStatus);

beforeEach(() => status.mockReset());

describe('GitState', () => {
  it('refresh sets status', async () => {
    status.mockResolvedValue(st('main'));
    const g = new GitState();
    g.path = '/p';
    await g.refresh();
    expect(g.status?.branch).toBe('main');
  });

  it('coalesces concurrent refreshes to at most two client calls', async () => {
    let release!: (s: RepoStatus) => void;
    status.mockImplementationOnce(() => new Promise((r) => (release = r)));
    status.mockResolvedValue(st('second'));
    const g = new GitState();
    g.path = '/p';
    const ps = [g.refresh(), g.refresh(), g.refresh(), g.refresh()];
    release(st('first'));
    await Promise.all(ps);
    expect(status).toHaveBeenCalledTimes(2);
    expect(g.status?.branch).toBe('second');
  });

  it('run sets busy then clears, and refreshes', async () => {
    status.mockResolvedValue(st('main'));
    const g = new GitState();
    g.path = '/p';
    let seen: string | null = null;
    const ok = await g.run('fetch', async () => {
      seen = g.busy;
    });
    expect(ok).toBe(true);
    expect(seen).toBe('fetch');
    expect(g.busy).toBeNull();
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('run stores error on reject and still refreshes', async () => {
    status.mockResolvedValue(st('main'));
    const g = new GitState();
    g.path = '/p';
    const ok = await g.run('push', async () => {
      throw 'rifiutato';
    });
    expect(ok).toBe(false);
    expect(g.error).toBe('rifiutato');
    expect(g.busy).toBeNull();
    expect(status).toHaveBeenCalledTimes(1);
  });
});

describe('GitState errors', () => {
  it('a failing refresh sets statusError, not the action error', async () => {
    status.mockImplementationOnce(async () => { throw 'boom'; });
    const g = new GitState();
    g.path = '/p';
    await g.refresh();
    expect(g.statusError).toBe('boom');
    expect(g.error).toBeNull();
  });

  it('a successful refresh clears statusError but keeps the action error', async () => {
    const g = new GitState();
    g.path = '/p';
    status.mockImplementationOnce(async () => { throw 'boom'; });
    await g.refresh();
    status.mockResolvedValue(st('main'));
    await g.run('push', async () => {
      throw 'rifiutato';
    });
    expect(g.statusError).toBeNull();
    expect(g.error).toBe('rifiutato');
    await g.refresh();
    expect(g.error).toBe('rifiutato');
  });
});
