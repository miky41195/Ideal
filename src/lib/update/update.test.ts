import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));

import { Updater, setBeforeInstall } from './update.svelte';

function fakeUpdate(order: string[]) {
  return {
    version: '0.3.0',
    body: 'note',
    download: vi.fn(async (cb: (e: unknown) => void) => {
      order.push('download');
      cb({ event: 'Started', data: { contentLength: 200 } });
      cb({ event: 'Progress', data: { chunkLength: 100 } });
    }),
    install: vi.fn(async () => void order.push('install')),
  };
}

describe('Updater', () => {
  it('check exposes the new version; nothing when up to date or offline', async () => {
    const u = new Updater({ check: async () => fakeUpdate([]) as never, wait: async () => {} });
    await u.checkNow();
    expect(u.available).toEqual({ version: '0.3.0', notes: 'note' });
    const none = new Updater({ check: async () => null, wait: async () => {} });
    await none.checkNow();
    expect(none.available).toBeNull();
    const offline = new Updater({ check: async () => Promise.reject(new Error('offline')), wait: async () => {} });
    await offline.checkNow();
    expect(offline.available).toBeNull();
  });

  it('install: download, then save unsaved buffers, wait for other windows, then install', async () => {
    const order: string[] = [];
    const up = fakeUpdate(order);
    const u = new Updater({ check: async () => up as never, wait: async () => void order.push('wait') });
    setBeforeInstall(async () => void order.push('backup'));
    await u.checkNow();
    await u.install();
    expect(order).toEqual(['download', 'backup', 'wait', 'install']);
    expect(u.progress).toBe(50);
  });

  it('a failed backup stops the install and shows why', async () => {
    const order: string[] = [];
    const up = fakeUpdate(order);
    const u = new Updater({ check: async () => up as never, wait: async () => {} });
    setBeforeInstall(async () => Promise.reject(new Error('troppo grande')));
    await u.checkNow();
    await u.install();
    expect(up.install).not.toHaveBeenCalled();
    expect(u.state).toBe('error');
    expect(u.error).toContain('salva');
    setBeforeInstall(async () => {});
  });
});
