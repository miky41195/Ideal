import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { SettingsStore } from './settings.svelte';
import { toasts } from '../ui/toast.svelte';

beforeEach(() => {
  invoke.mockReset();
  toasts.items = [];
});

describe('SettingsStore', () => {
  it('ready goes false -> true after init and applies settings', async () => {
    invoke.mockResolvedValue({ settings: { terminal: { shell: 'pwsh', fontSize: 16 } }, warning: null });
    const s = new SettingsStore();
    expect(s.ready).toBe(false);
    await s.init();
    expect(s.ready).toBe(true);
    expect(s.value.terminal.shell).toBe('pwsh');
  });
  it('ready is true on invoke failure, with defaults and a toast', async () => {
    invoke.mockRejectedValue(new Error('boom'));
    const s = new SettingsStore();
    await s.init();
    expect(s.ready).toBe(true);
    expect(s.value.terminal.fontSize).toBe(13);
    expect(toasts.items).toHaveLength(1);
  });
  it('does not stack identical warning toasts', async () => {
    invoke.mockResolvedValue({ settings: {}, warning: 'x' });
    const a = new SettingsStore();
    const b = new SettingsStore();
    await a.init();
    await b.init();
    expect(toasts.items).toHaveLength(1);
  });
});
